/* eslint-disable @typescript-eslint/no-explicit-any -- fetch stubs accept the platform's loose signature */
import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";

// E9b 5: a Stop during context assembly aborts the retrieval's query
// embedding fetch, and the aborted call is not retried.

mock.module("@/lib/llm-usage", { namedExports: { logLlmCall: mock.fn() } });

let OllamaEmbeddingProvider: typeof import("../ollama-embedding-provider").OllamaEmbeddingProvider;

before(async () => {
  ({ OllamaEmbeddingProvider } = await import("../ollama-embedding-provider"));
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("the embedding fetch takes the turn's signal (E9b 5)", () => {
  it("the local fetch gets the signal, a Stop aborts it, and it is tried once", async () => {
    const seen: AbortSignal[] = [];
    global.fetch = (async (_url: any, init: any) => {
      seen.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    }) as any;
    const turn = new AbortController();
    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    const pending = provider.embed(["how do i get my osha card"], { taskType: "RETRIEVAL_QUERY", signal: turn.signal });
    await new Promise((resolve) => setImmediate(resolve));
    turn.abort(new DOMException("stopped", "AbortError"));
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(seen.length, 1, "an aborted embedding is not retried");
    assert.equal(seen[0], turn.signal);
  });
});
