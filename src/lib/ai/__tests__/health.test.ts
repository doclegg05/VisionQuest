import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { checkOllamaHealth } from "../health";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe("checkOllamaHealth", () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
  });

  it("returns healthy when Ollama responds with models", async () => {
    mockFetch.mock.mockImplementationOnce(async () =>
      Response.json({ models: [{ name: "gemma4:26b" }] }),
    );

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
    });
  });

  it("returns unhealthy on network error", async () => {
    mockFetch.mock.mockImplementationOnce(async () => {
      throw new Error("Connection refused");
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: false,
      error: "Connection refused",
    });
  });

  it("returns unhealthy on non-ok response", async () => {
    mockFetch.mock.mockImplementationOnce(async () =>
      new Response(null, { status: 503 }),
    );

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: false,
      error: "Server returned 503",
    });
  });
});
