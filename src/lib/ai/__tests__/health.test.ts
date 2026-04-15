import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { checkOllamaHealth } from "../health";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe("checkOllamaHealth", () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
  });

  it("returns healthy with OpenAI mode when health and chat checks succeed", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("http://localhost:11434", {
      model: "gemma4:26b",
    });
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
      apiMode: "openai",
      chatValidated: true,
      modelUsed: "gemma4:26b",
    });
  });

  it("returns healthy with native mode when /v1 is unavailable but native chat works", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/api/chat")) {
        return Response.json({ message: { content: "OK" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("http://localhost:11434", {
      model: "gemma4:26b",
    });
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
      apiMode: "native",
      chatValidated: true,
      modelUsed: "gemma4:26b",
    });
  });

  it("falls back to /v1 models when /api/tags is unavailable", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(null, { status: 404 });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("http://localhost:11434", {});
    assert.deepEqual(result, {
      healthy: true,
      models: ["gemma4:26b"],
      apiMode: "openai",
      chatValidated: true,
      modelUsed: "gemma4:26b",
    });
  });

  it("returns unhealthy when auth config is incomplete", async () => {
    const result = await checkOllamaHealth("http://localhost:11434", {
      authConfig: {
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
      },
    });

    assert.deepEqual(result, {
      healthy: false,
      error:
        "Cloudflare Access service token is not configured. Set the client ID and client secret in Program Setup > AI Provider.",
    });
  });

  it("sends Cloudflare service-token headers to health and chat probes", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["CF-Access-Client-Id"], "client-id");
      assert.equal(headers["CF-Access-Client-Secret"], "client-secret");

      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("https://llm.example.com", {
      model: "gemma4:26b",
      authConfig: {
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
        cloudflareAccessClientSecret: "client-secret",
      },
    });

    assert.equal(result.healthy, true);
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

  it("returns unhealthy when the detected chat endpoint fails", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return new Response("Forbidden", { status: 403 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await checkOllamaHealth("https://llm.example.com", {
      model: "gemma4:26b",
    });
    assert.deepEqual(result, {
      healthy: false,
      models: ["gemma4:26b"],
      apiMode: "openai",
      modelUsed: "gemma4:26b",
      error: "Chat endpoint returned 403",
    });
  });
});
