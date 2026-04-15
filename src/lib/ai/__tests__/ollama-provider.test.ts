import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe("OllamaProvider", { concurrency: false }, () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in OllamaProvider test");
    });
    provider = new OllamaProvider("http://localhost:11434", "gemma4:26b");
  });

  describe("generateResponse", () => {
    it("sends correct request and returns response text", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "Hello there!" } }],
        }),
      );

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "Hello there!");

      const call = mockFetch.mock.calls[0];
      assert.equal(call.arguments[0], "http://localhost:11434/v1/chat/completions");
      const body = JSON.parse((call.arguments[1] as RequestInit).body as string);
      assert.equal(body.model, "gemma4:26b");
      assert.equal(body.stream, false);
      assert.deepEqual(body.messages[0], { role: "system", content: "Be helpful." });
      assert.deepEqual(body.messages[1], { role: "user", content: "Hi" });
    });

    it("throws on non-ok response", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        new Response("Internal Server Error", { status: 500 }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /Local AI request failed \(500\)/,
      );
    });

    it("falls back to native Ollama chat when the OpenAI path returns 404", async () => {
      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response("Not Found", { status: 404 });
        }
        return Response.json({
          message: { content: "Hello from native Ollama!" },
        });
      });

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "Hello from native Ollama!");
      assert.equal(mockFetch.mock.calls[0].arguments[0], "http://localhost:11434/v1/chat/completions");
      assert.equal(mockFetch.mock.calls[1].arguments[0], "http://localhost:11434/api/chat");
    });
  });

  describe("generateStructuredResponse", () => {
    it("sets response_format for JSON output", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: '{"goals_found":[]}' } }],
        }),
      );

      const result = await provider.generateStructuredResponse("Extract goals.", [
        { role: "user", content: "I want to learn coding" },
      ]);

      assert.equal(result, '{"goals_found":[]}');
      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.deepEqual(body.response_format, { type: "json_object" });
    });

    it("falls back to native JSON mode when the OpenAI path returns 404", async () => {
      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response("Not Found", { status: 404 });
        }
        return Response.json({
          message: { content: '{"goals_found":[]}' },
        });
      });

      const result = await provider.generateStructuredResponse("Extract goals.", [
        { role: "user", content: "I want to learn coding" },
      ]);

      assert.equal(result, '{"goals_found":[]}');
      const nativeBody = JSON.parse(
        (mockFetch.mock.calls[1].arguments[1] as RequestInit).body as string,
      );
      assert.equal(nativeBody.format, "json");
    });
  });

  describe("streamResponse", () => {
    it("yields chunks from SSE stream", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        "data: " + JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }) + "\n\n",
        "data: " + JSON.stringify({ choices: [{ delta: { content: " world" } }] }) + "\n\n",
        "data: [DONE]\n\n",
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      mockFetch.mock.mockImplementationOnce(
        async () => new Response(stream, { status: 200 }),
      );

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      assert.deepEqual(result, ["Hello", " world"]);
      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.equal(body.stream, true);
    });

    it("falls back to native streamed chat when the OpenAI path returns 404", async () => {
      const encoder = new TextEncoder();
      const nativeChunks = [
        JSON.stringify({
          message: { content: "Hello" },
          done: false,
        }) + "\n",
        JSON.stringify({
          message: { content: " world" },
          done: false,
        }) + "\n",
        JSON.stringify({
          message: { content: "" },
          done: true,
        }) + "\n",
      ];

      const nativeStream = new ReadableStream({
        start(controller) {
          for (const chunk of nativeChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(nativeStream, { status: 200 });
      });

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      assert.deepEqual(result, ["Hello", " world"]);
      assert.equal(mockFetch.mock.calls[1].arguments[0], "http://localhost:11434/api/chat");
    });
  });

  describe("message role mapping", () => {
    it("maps 'model' role to 'assistant' for OpenAI format", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "ok" } }],
        }),
      );

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
        { role: "model", content: "Hello" },
        { role: "user", content: "How are you?" },
      ]);

      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.deepEqual(body.messages[1], { role: "user", content: "Hi" });
      assert.deepEqual(body.messages[2], { role: "assistant", content: "Hello" });
      assert.deepEqual(body.messages[3], { role: "user", content: "How are you?" });
    });
  });

  describe("auth headers", () => {
    it("sends bearer auth when configured", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "bearer",
        apiKey: "test-token",
      });

      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "ok" } }],
        }),
      );

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      const headers = (mockFetch.mock.calls[0].arguments[1] as RequestInit)
        .headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-token");
    });

    it("sends Cloudflare Access service-token headers when configured", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
        cloudflareAccessClientSecret: "client-secret",
      });

      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "ok" } }],
        }),
      );

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      const headers = (mockFetch.mock.calls[0].arguments[1] as RequestInit)
        .headers as Record<string, string>;
      assert.equal(headers["CF-Access-Client-Id"], "client-id");
      assert.equal(headers["CF-Access-Client-Secret"], "client-secret");
    });

    it("throws when bearer auth is selected without a token", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "bearer",
      });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /bearer token is not configured/i,
      );
    });

    it("throws when Cloudflare auth is selected without both credentials", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
      });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /cloudflare access service token is not configured/i,
      );
    });
  });
});
