/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const mockLogLlmCall = mock.fn() as any;

mock.module("@/lib/llm-usage", {
  namedExports: {
    logLlmCall: mockLogLlmCall,
  },
});

let EMBEDDING_DIMENSIONS: number;
let EMBEDDING_MODEL: string;
let embedQuery: typeof import("./embeddings").embedQuery;
let embedTexts: typeof import("./embeddings").embedTexts;
let toVectorLiteral: typeof import("./embeddings").toVectorLiteral;

before(async () => {
  const mod = await import("./embeddings");
  EMBEDDING_DIMENSIONS = mod.EMBEDDING_DIMENSIONS;
  EMBEDDING_MODEL = mod.EMBEDDING_MODEL;
  embedQuery = mod.embedQuery;
  embedTexts = mod.embedTexts;
  toVectorLiteral = mod.toVectorLiteral;
});

const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;

function unitVector(dims: number, index: number): number[] {
  const v = new Array(dims).fill(0);
  v[index % dims] = 1;
  return v;
}

/** Build a batchEmbedContents-shaped success response. */
function batchResponse(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({ embeddings: vectors.map((values) => ({ values })) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("embedTexts", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    mockLogLlmCall.mock.resetCalls();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it("rejects empty input", async () => {
    await assert.rejects(
      () => embedTexts([], { taskType: "RETRIEVAL_DOCUMENT" }),
      /at least one text/i,
    );
    await assert.rejects(
      () => embedTexts(["   "], { taskType: "RETRIEVAL_DOCUMENT" }),
      /empty/i,
    );
  });

  it("requires GEMINI_API_KEY", async () => {
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      () => embedTexts(["hello"], { taskType: "RETRIEVAL_DOCUMENT" }),
      /GEMINI_API_KEY/,
    );
  });

  it("embeds a batch and returns vectors in order", async () => {
    const calls: Array<{ url: string; body: any; headers: Headers }> = [];
    global.fetch = (async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), body, headers: new Headers(init.headers) });
      return batchResponse(body.requests.map((_: unknown, i: number) => unitVector(768, i)));
    }) as any;

    const result = await embedTexts(["alpha", "beta"], { taskType: "RETRIEVAL_DOCUMENT" });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /gemini-embedding-001:batchEmbedContents$/);
    assert.equal(calls[0].headers.get("x-goog-api-key"), "test-key");
    assert.equal(calls[0].body.requests.length, 2);
    assert.equal(calls[0].body.requests[0].taskType, "RETRIEVAL_DOCUMENT");
    assert.equal(calls[0].body.requests[0].outputDimensionality, 768);
    assert.equal(calls[0].body.requests[0].content.parts[0].text, "alpha");
    assert.equal(result.length, 2);
    assert.equal(result[0].length, EMBEDDING_DIMENSIONS);
    assert.equal(result[0][0], 1);
    assert.equal(result[1][1], 1);
  });

  it("splits batches at 100 texts per request", async () => {
    const batchSizes: number[] = [];
    global.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      batchSizes.push(body.requests.length);
      return batchResponse(body.requests.map(() => unitVector(768, 0)));
    }) as any;

    const texts = Array.from({ length: 101 }, (_, i) => `text ${i}`);
    const result = await embedTexts(texts, { taskType: "RETRIEVAL_DOCUMENT" });

    assert.deepEqual(batchSizes, [100, 1]);
    assert.equal(result.length, 101);
  });

  it("L2-normalizes vectors to unit norm", async () => {
    global.fetch = (async () =>
      batchResponse([new Array(768).fill(2)])) as any;

    const [vec] = await embedTexts(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`);
  });

  it("retries on 429 then succeeds", async () => {
    let attempts = 0;
    global.fetch = (async (_url: any, init: any) => {
      attempts++;
      if (attempts === 1) {
        return new Response("rate limited", { status: 429 });
      }
      const body = JSON.parse(init.body);
      return batchResponse(body.requests.map(() => unitVector(768, 0)));
    }) as any;

    const result = await embedTexts(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });
    assert.equal(attempts, 2);
    assert.equal(result.length, 1);
  });

  it("throws after exhausting retries", async () => {
    let attempts = 0;
    global.fetch = (async () => {
      attempts++;
      return new Response("boom", { status: 500 });
    }) as any;

    await assert.rejects(
      () => embedTexts(["hello"], { taskType: "RETRIEVAL_DOCUMENT" }),
      /500/,
    );
    assert.equal(attempts, 3);
  });

  it("throws on dimension mismatch", async () => {
    global.fetch = (async () => batchResponse([[0.1, 0.2, 0.3]])) as any;

    await assert.rejects(
      () => embedTexts(["hello"], { taskType: "RETRIEVAL_DOCUMENT" }),
      /768/,
    );
  });

  it("logs usage per API call with the provided callSite", async () => {
    global.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return batchResponse(body.requests.map(() => unitVector(768, 0)));
    }) as any;

    await embedTexts(["abcdefgh"], {
      taskType: "RETRIEVAL_DOCUMENT",
      usage: { studentId: null, callSite: "sage_embedding_backfill" },
    });

    assert.equal(mockLogLlmCall.mock.callCount(), 1);
    const params = mockLogLlmCall.mock.calls[0].arguments[0];
    assert.equal(params.callSite, "sage_embedding_backfill");
    assert.equal(params.model, EMBEDDING_MODEL);
    assert.equal(params.studentId, null);
    // ceil(8 chars / 4) = 2 estimated input tokens
    assert.equal(params.inputTokens, 2);
    assert.equal(params.totalTokens, 2);
  });
});

describe("embedQuery", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    mockLogLlmCall.mock.resetCalls();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it("uses RETRIEVAL_QUERY task type and returns a single vector", async () => {
    let taskType = "";
    global.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      taskType = body.requests[0].taskType;
      return batchResponse([unitVector(768, 5)]);
    }) as any;

    const vec = await embedQuery("where is the dress code?");
    assert.equal(taskType, "RETRIEVAL_QUERY");
    assert.equal(vec.length, EMBEDDING_DIMENSIONS);
    assert.equal(vec[5], 1);
  });
});

describe("toVectorLiteral", () => {
  it("formats a pgvector literal", () => {
    assert.equal(toVectorLiteral([0.5, -1, 2]), "[0.5,-1,2]");
  });

  it("rejects non-finite components", () => {
    assert.throws(() => toVectorLiteral([1, Number.NaN]), /finite/i);
  });
});
