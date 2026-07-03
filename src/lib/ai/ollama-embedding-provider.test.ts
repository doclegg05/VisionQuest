/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const mockLogLlmCall = mock.fn() as any;

mock.module("@/lib/llm-usage", {
  namedExports: {
    logLlmCall: mockLogLlmCall,
  },
});

let OllamaEmbeddingProvider: typeof import("./ollama-embedding-provider").OllamaEmbeddingProvider;
let DEFAULT_LOCAL_EMBEDDING_MODEL: string;

before(async () => {
  const mod = await import("./ollama-embedding-provider");
  OllamaEmbeddingProvider = mod.OllamaEmbeddingProvider;
  DEFAULT_LOCAL_EMBEDDING_MODEL = mod.DEFAULT_LOCAL_EMBEDDING_MODEL;
});

const originalFetch = global.fetch;

function unitVector(dims: number, index: number): number[] {
  const v = new Array(dims).fill(0);
  v[index % dims] = 1;
  return v;
}

describe("OllamaEmbeddingProvider", () => {
  beforeEach(() => {
    mockLogLlmCall.mock.resetCalls();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exposes name and model, defaulting to nomic-embed-text", () => {
    assert.equal(DEFAULT_LOCAL_EMBEDDING_MODEL, "nomic-embed-text");
    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    assert.equal(provider.name, "ollama");
    assert.equal(provider.model, "nomic-embed-text");
  });

  it("rejects empty input", async () => {
    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    await assert.rejects(
      () => provider.embed([], { taskType: "RETRIEVAL_DOCUMENT" }),
      /at least one text/i,
    );
    await assert.rejects(
      () => provider.embed(["  "], { taskType: "RETRIEVAL_DOCUMENT" }),
      /empty/i,
    );
  });

  it("uses the native /api/embed endpoint by default", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = (async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), body });
      return new Response(
        JSON.stringify({ embeddings: body.input.map((_: unknown, i: number) => unitVector(768, i)) }),
        { status: 200 },
      );
    }) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    const result = await provider.embed(["alpha", "beta"], { taskType: "RETRIEVAL_DOCUMENT" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:11434/api/embed");
    assert.equal(calls[0].body.model, "nomic-embed-text");
    assert.deepEqual(calls[0].body.input, ["alpha", "beta"]);
    assert.equal(result.length, 2);
    assert.equal(result[0].length, 768);
  });

  it("falls back to /v1/embeddings on 404 from the native endpoint", async () => {
    const urls: string[] = [];
    global.fetch = (async (url: any, init: any) => {
      urls.push(String(url));
      if (String(url).endsWith("/api/embed")) {
        return new Response("not found", { status: 404 });
      }
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: unknown, i: number) => ({ embedding: unitVector(768, i) })),
        }),
        { status: 200 },
      );
    }) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    const result = await provider.embed(["alpha"], { taskType: "RETRIEVAL_QUERY" });

    assert.deepEqual(urls, [
      "http://localhost:11434/api/embed",
      "http://localhost:11434/v1/embeddings",
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 768);
  });

  it("remembers the /v1 fallback after a 404 and skips native on subsequent calls", async () => {
    let nativeCalls = 0;
    let openAiCalls = 0;
    global.fetch = (async (url: any, init: any) => {
      if (String(url).endsWith("/api/embed")) {
        nativeCalls++;
        return new Response("not found", { status: 404 });
      }
      openAiCalls++;
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: unknown, i: number) => ({ embedding: unitVector(768, i) })),
        }),
        { status: 200 },
      );
    }) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    await provider.embed(["one"], { taskType: "RETRIEVAL_QUERY" });
    await provider.embed(["two"], { taskType: "RETRIEVAL_QUERY" });

    assert.equal(nativeCalls, 1, "should only probe native once, then remember the fallback");
    assert.equal(openAiCalls, 2);
  });

  it("L2-normalizes vectors client-side", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ embeddings: [new Array(768).fill(2)] }), { status: 200 })) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    const [vec] = await provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`);
  });

  it("hard-asserts 768 dims and rejects 1024-dim models instead of truncating", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ embeddings: [new Array(1024).fill(1)] }), { status: 200 })) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "mxbai-embed-large");
    await assert.rejects(
      () => provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" }),
      /mxbai-embed-large.*1024|768/i,
    );
  });

  it("retries transient failures via the shared retryWithBackoff pattern", async () => {
    let attempts = 0;
    global.fetch = (async (url: any) => {
      if (String(url).endsWith("/api/embed")) {
        attempts++;
        if (attempts < 2) return new Response("server error", { status: 500 });
        return new Response(JSON.stringify({ embeddings: [unitVector(768, 0)] }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    const result = await provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });
    assert.equal(attempts, 2);
    assert.equal(result.length, 1);
  });

  it("sends bearer auth headers when configured", async () => {
    const headersSeen: Headers[] = [];
    global.fetch = (async (_url: any, init: any) => {
      headersSeen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ embeddings: [unitVector(768, 0)] }), { status: 200 });
    }) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text", {
      authMode: "bearer",
      apiKey: "secret-token",
    });
    await provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });

    assert.equal(headersSeen[0].get("Authorization"), "Bearer secret-token");
  });

  it("sends Cloudflare Access service-token headers when configured", async () => {
    const headersSeen: Headers[] = [];
    global.fetch = (async (_url: any, init: any) => {
      headersSeen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ embeddings: [unitVector(768, 0)] }), { status: 200 });
    }) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text", {
      authMode: "cloudflare_service_token",
      cloudflareAccessClientId: "client-id",
      cloudflareAccessClientSecret: "client-secret",
    });
    await provider.embed(["hello"], { taskType: "RETRIEVAL_DOCUMENT" });

    assert.equal(headersSeen[0].get("CF-Access-Client-Id"), "client-id");
    assert.equal(headersSeen[0].get("CF-Access-Client-Secret"), "client-secret");
  });

  it("logs usage with the local model name", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ embeddings: [unitVector(768, 0)] }), { status: 200 })) as any;

    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "embeddinggemma");
    await provider.embed(["abcdefgh"], {
      taskType: "RETRIEVAL_DOCUMENT",
      callSite: "sage_embedding_ingest",
      studentId: "student-1",
    });

    assert.equal(mockLogLlmCall.mock.callCount(), 1);
    const params = mockLogLlmCall.mock.calls[0].arguments[0];
    assert.equal(params.model, "embeddinggemma");
    assert.equal(params.callSite, "sage_embedding_ingest");
    assert.equal(params.studentId, "student-1");
  });
});
