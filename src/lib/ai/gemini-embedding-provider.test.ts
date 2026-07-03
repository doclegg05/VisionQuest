/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const mockLogLlmCall = mock.fn() as any;

mock.module("@/lib/llm-usage", {
  namedExports: {
    logLlmCall: mockLogLlmCall,
  },
});

let GeminiEmbeddingProvider: typeof import("./gemini-embedding-provider").GeminiEmbeddingProvider;
let EMBEDDING_DIMENSIONS: number;

before(async () => {
  const providerMod = await import("./gemini-embedding-provider");
  const typesMod = await import("./embedding-types");
  GeminiEmbeddingProvider = providerMod.GeminiEmbeddingProvider;
  EMBEDDING_DIMENSIONS = typesMod.EMBEDDING_DIMENSIONS;
});

const originalFetch = global.fetch;

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

describe("GeminiEmbeddingProvider", () => {
  beforeEach(() => {
    mockLogLlmCall.mock.resetCalls();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exposes name and model", () => {
    const provider = new GeminiEmbeddingProvider("test-key");
    assert.equal(provider.name, "gemini");
    assert.equal(provider.model, "gemini-embedding-001");
  });

  it("rejects empty input", async () => {
    const provider = new GeminiEmbeddingProvider("test-key");
    await assert.rejects(
      () => provider.embed([], { taskType: "RETRIEVAL_DOCUMENT" }),
      /at least one text/i,
    );
    await assert.rejects(
      () => provider.embed(["   "], { taskType: "RETRIEVAL_DOCUMENT" }),
      /empty/i,
    );
  });

  it("embeds a batch and returns vectors in order", async () => {
    const calls: Array<{ url: string; body: any; headers: Headers }> = [];
    global.fetch = (async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), body, headers: new Headers(init.headers) });
      return batchResponse(body.requests.map((_: unknown, i: number) => unitVector(768, i)));
    }) as any;

    const provider = new GeminiEmbeddingProvider("test-key");
    const result = await provider.embed(["alpha", "beta"], { taskType: "RETRIEVAL_DOCUMENT" });

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

    const provider = new GeminiEmbeddingProvider("test-key");
    const texts = Array.from({ length: 101 }, (_, i) => `text ${i}`);
    const result = await provider.embed(texts, { taskType: "RETRIEVAL_DOCUMENT" });

    assert.deepEqual(batchSizes, [100, 1]);
    assert.equal(result.length, 101);
  });

  it("L2-normalizes vectors to unit norm", async () => {
    global.fetch = (async () => batchResponse([new Array(768).fill(2)])) as any;

    const provider = new GeminiEmbeddingProvider("test-key");
    const [vec] = await provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });
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

    const provider = new GeminiEmbeddingProvider("test-key");
    const result = await provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });
    assert.equal(attempts, 2);
    assert.equal(result.length, 1);
  });

  it("throws after exhausting retries", async () => {
    let attempts = 0;
    global.fetch = (async () => {
      attempts++;
      return new Response("boom", { status: 500 });
    }) as any;

    const provider = new GeminiEmbeddingProvider("test-key");
    await assert.rejects(
      () => provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" }),
      /500/,
    );
    assert.equal(attempts, 3);
  });

  it("throws on dimension mismatch", async () => {
    global.fetch = (async () => batchResponse([[0.1, 0.2, 0.3]])) as any;

    const provider = new GeminiEmbeddingProvider("test-key");
    await assert.rejects(
      () => provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" }),
      /768/,
    );
  });

  it("logs usage per API call with the provided callSite and studentId", async () => {
    global.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return batchResponse(body.requests.map(() => unitVector(768, 0)));
    }) as any;

    const provider = new GeminiEmbeddingProvider("test-key");
    await provider.embed(["abcdefgh"], {
      taskType: "RETRIEVAL_DOCUMENT",
      callSite: "sage_embedding_backfill",
      studentId: null,
    });

    assert.equal(mockLogLlmCall.mock.callCount(), 1);
    const params = mockLogLlmCall.mock.calls[0].arguments[0];
    assert.equal(params.callSite, "sage_embedding_backfill");
    assert.equal(params.model, "gemini-embedding-001");
    assert.equal(params.studentId, null);
    // ceil(8 chars / 4) = 2 estimated input tokens
    assert.equal(params.inputTokens, 2);
    assert.equal(params.totalTokens, 2);
  });

  it("defaults callSite to sage_embedding and studentId to null when omitted", async () => {
    global.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return batchResponse(body.requests.map(() => unitVector(768, 0)));
    }) as any;

    const provider = new GeminiEmbeddingProvider("test-key");
    await provider.embed(["hello"], { taskType: "RETRIEVAL_QUERY" });

    const params = mockLogLlmCall.mock.calls[0].arguments[0];
    assert.equal(params.callSite, "sage_embedding");
    assert.equal(params.studentId, null);
  });
});
