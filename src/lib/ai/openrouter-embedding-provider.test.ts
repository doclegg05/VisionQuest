import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { inspect } from "node:util";

import { APP_SERVER_FLAG, markAppServer } from "./app-server";

import {
  OPENROUTER_EMBEDDING_MODEL,
  OpenRouterEmbeddingProvider,
  fitToDimensions,
} from "./openrouter-embedding-provider";
import { OpenRouterError } from "./openrouter-provider";

/**
 * Eval-only: the memory and RAG evals embed synthetic text through
 * OpenRouter's google/gemini-embedding-001 when CI has no Gemini key. The app
 * never constructs this provider (openrouter-import-guard.test.ts and
 * embedding-provider.eval-override.test.ts).
 */

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function vector(length: number, first = 3, second = 4): number[] {
  return Array.from({ length }, (_, index) => (index === 0 ? first : index === 1 ? second : 0));
}

function fakeFetch(replies: Array<{ status: number; json?: unknown } | "network">) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function ok(vectors: number[][], extra: Record<string, unknown> = {}) {
  return { status: 200, json: { data: vectors.map((embedding, index) => ({ embedding, index })), ...extra } };
}

const noSleep = async () => undefined;

function provider(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  return new OpenRouterEmbeddingProvider("sk-or-test", undefined, { fetchImpl, sleep: noSleep, ...options });
}

const EMBED = { taskType: "RETRIEVAL_DOCUMENT" as const };

describe("OpenRouterEmbeddingProvider", () => {
  afterEach(() => {
    delete process.env.RENDER;
    delete process.env.NEXT_RUNTIME;
    Reflect.deleteProperty(globalThis, APP_SERVER_FLAG);
  });

  it("asks OpenRouter for production's embedding model at 768 dimensions with the privacy fields", async () => {
    const { fetchImpl, calls } = fakeFetch([ok([vector(768)])]);
    await provider(fetchImpl).embed(["hello"], EMBED);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/embeddings");
    assert.equal(calls[0].headers.authorization, "Bearer sk-or-test");
    assert.deepEqual(calls[0].body, {
      model: "google/gemini-embedding-001",
      input: ["hello"],
      dimensions: 768,
      encoding_format: "float",
      provider: { zdr: true, data_collection: "deny" },
    });
    assert.equal(OPENROUTER_EMBEDDING_MODEL, "google/gemini-embedding-001");
  });

  it("returns L2-normalized vectors in input order, whatever order the reply uses", async () => {
    const reply = { status: 200, json: { data: [{ embedding: vector(768, 0, 2), index: 1 }, { embedding: vector(768), index: 0 }] } };
    const { fetchImpl } = fakeFetch([reply]);
    const [first, second] = await provider(fetchImpl).embed(["a", "b"], EMBED);
    assert.deepEqual(first.slice(0, 2), [0.6, 0.8]);
    assert.deepEqual(second.slice(0, 2), [0, 1]);
    assert.equal(first.length, 768);
  });

  it("truncates a full-size reply to 768 and renormalizes, since dimensions may be ignored", async () => {
    const full = vector(3072);
    full[1000] = 100;
    const { fetchImpl } = fakeFetch([ok([full])]);
    const [result] = await provider(fetchImpl).embed(["a"], EMBED);
    assert.equal(result.length, 768);
    assert.deepEqual(result.slice(0, 2), [0.6, 0.8]);
  });

  it("splits more than 100 texts into batches", async () => {
    const texts = Array.from({ length: 150 }, (_, index) => `t${index}`);
    const { fetchImpl, calls } = fakeFetch([ok(Array.from({ length: 100 }, () => vector(768))), ok(Array.from({ length: 50 }, () => vector(768)))]);
    const vectors = await provider(fetchImpl).embed(texts, EMBED);
    assert.equal(vectors.length, 150);
    assert.deepEqual(calls.map((call) => (call.body.input as string[]).length), [100, 50]);
  });

  it("reports each batch's billed cost", async () => {
    const costs: number[] = [];
    const { fetchImpl } = fakeFetch([ok([vector(768)], { usage: { prompt_tokens: 3, cost: 0.00002 } })]);
    await provider(fetchImpl, { onCost: (usd: number) => costs.push(usd) }).embed(["a"], EMBED);
    assert.deepEqual(costs, [0.00002]);
  });

  it("refuses a reply that is too short, the wrong count, or not vectors", async () => {
    for (const reply of [ok([vector(512)]), ok([vector(768), vector(768)]), { status: 200, json: { data: [{ embedding: "x", index: 0 }] } }]) {
      const { fetchImpl } = fakeFetch([reply]);
      await assert.rejects(provider(fetchImpl).embed(["a"], EMBED), (error: unknown) => error instanceof OpenRouterError);
    }
  });

  it("refuses duplicate or non-integer indexes instead of leaving a hole", async () => {
    const replies = [
      { status: 200, json: { data: [{ embedding: vector(768), index: 0 }, { embedding: vector(768), index: 0 }] } },
      { status: 200, json: { data: [{ embedding: vector(768), index: 0.5 }, { embedding: vector(768), index: 1 }] } },
    ];
    for (const reply of replies) {
      const { fetchImpl } = fakeFetch([reply]);
      await assert.rejects(provider(fetchImpl).embed(["a", "b"], EMBED), (error: unknown) => error instanceof OpenRouterError);
    }
  });

  it("classifies failures the way the eval harness reads them", async () => {
    const cases: Array<[number, string]> = [
      [402, "credits"],
      [401, "bad_request"],
      [404, "bad_request"],
    ];
    for (const [status, kind] of cases) {
      const { fetchImpl, calls } = fakeFetch([{ status, json: { error: { code: status } } }]);
      await assert.rejects(provider(fetchImpl).embed(["a"], EMBED), (error: unknown) => {
        assert.ok(error instanceof OpenRouterError);
        assert.equal(error.kind, kind);
        assert.equal(error.status, status);
        return true;
      });
      assert.equal(calls.length, 1, `${status} must not be retried`);
    }
    const { fetchImpl } = fakeFetch(["network"]);
    await assert.rejects(provider(fetchImpl).embed(["a"], EMBED), (error: unknown) => error instanceof OpenRouterError && error.kind === "network");
  });

  it("retries a server error before giving up", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 503 }, ok([vector(768)])]);
    const [result] = await provider(fetchImpl).embed(["a"], EMBED);
    assert.equal(calls.length, 2);
    assert.equal(result.length, 768);
  });

  it("never puts the key or the reply body in an error message", async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, json: { error: { message: "secret-detail" } } }]);
    await assert.rejects(provider(fetchImpl).embed(["a"], EMBED), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /sk-or-test|secret-detail/);
      return true;
    });
  });

  it("rejects empty input and blank texts before calling out", async () => {
    const { fetchImpl, calls } = fakeFetch([ok([vector(768)])]);
    await assert.rejects(provider(fetchImpl).embed([], EMBED));
    await assert.rejects(provider(fetchImpl).embed(["  "], EMBED));
    assert.equal(calls.length, 0);
  });

  it("refuses to run without a key or inside the app server", () => {
    assert.throws(() => new OpenRouterEmbeddingProvider(""), OpenRouterError);
    process.env.RENDER = "true";
    assert.throws(() => new OpenRouterEmbeddingProvider("sk-or-test"), /eval-only/);
  });

  it("refuses to run once the server has marked itself at boot, whatever the environment says", () => {
    markAppServer();
    assert.throws(() => new OpenRouterEmbeddingProvider("sk-or-test"), /eval-only/);
  });

  it("never exposes the key when the provider is logged or serialized", () => {
    const instance = new OpenRouterEmbeddingProvider("sk-or-secret-value");
    assert.doesNotMatch(JSON.stringify(instance), /sk-or-secret-value/);
    assert.doesNotMatch(inspect(instance, { showHidden: true, depth: 5 }), /sk-or-secret-value/);
  });
});

describe("fitToDimensions", () => {
  it("keeps the first 768 components and L2-normalizes them", () => {
    const fitted = fitToDimensions([3, 4, ...new Array(3070).fill(0)]);
    assert.equal(fitted.length, 768);
    assert.deepEqual(fitted.slice(0, 2), [0.6, 0.8]);
  });

  it("rejects a vector shorter than 768 or with a non-finite component", () => {
    assert.throws(() => fitToDimensions(new Array(767).fill(1)));
    assert.throws(() => fitToDimensions([Number.NaN, ...new Array(767).fill(1)]));
  });

  it("does not modify its input", () => {
    const input = [3, 4, ...new Array(766).fill(0)];
    fitToDimensions(input);
    assert.deepEqual(input.slice(0, 2), [3, 4]);
  });
});
