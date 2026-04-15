import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { checkOllamaHealth } from "../health";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe("checkOllamaHealth", () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
  });

  it("returns healthy with OpenAI mode when both Ollama surfaces are available", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
      apiMode: "openai",
    });
  });

  it("returns healthy with native mode when /v1 is unavailable", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return new Response("Not Found", { status: 404 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
      apiMode: "native",
    });
  });

  it("falls back to /v1/models when /api/tags is unavailable", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(null, { status: 404 });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
      apiMode: "openai",
    });
  });

  it("returns unhealthy when the server cannot be reached", async () => {
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Connection refused");
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: false,
      error: "Connection refused",
    });
  });

  it("returns unhealthy when both endpoints return errors", async () => {
    mockFetch.mock.mockImplementation(async () =>
      new Response(null, { status: 503 }),
    );

    const result = await checkOllamaHealth("http://localhost:11434");
    assert.deepEqual(result, {
      healthy: false,
      error: "Server returned 503",
    });
  });
});
