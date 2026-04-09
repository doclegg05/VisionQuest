import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe("OllamaProvider", () => {
  const provider = new OllamaProvider("http://localhost:11434", "gemma4:26b");

  beforeEach(() => {
    mockFetch.mock.resetCalls();
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
});
