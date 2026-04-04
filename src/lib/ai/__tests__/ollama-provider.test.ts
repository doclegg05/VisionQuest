import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("OllamaProvider", () => {
  const provider = new OllamaProvider("http://localhost:11434", "gemma4:26b");

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("generateResponse", () => {
    it("sends correct request and returns response text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hello there!" } }],
        }),
      });

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      expect(result).toBe("Hello there!");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:11434/v1/chat/completions");
      const body = JSON.parse(options.body);
      expect(body.model).toBe("gemma4:26b");
      expect(body.stream).toBe(false);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful." });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
      ).rejects.toThrow("Ollama request failed (500)");
    });
  });

  describe("generateStructuredResponse", () => {
    it("sets response_format for JSON output", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"goals_found":[]}' } }],
        }),
      });

      const result = await provider.generateStructuredResponse("Extract goals.", [
        { role: "user", content: "I want to learn coding" },
      ]);

      expect(result).toBe('{"goals_found":[]}');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: "json_object" });
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      expect(result).toEqual(["Hello", " world"]);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });
  });

  describe("message role mapping", () => {
    it("maps 'model' role to 'assistant' for OpenAI format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
        }),
      });

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
        { role: "model", content: "Hello" },
        { role: "user", content: "How are you?" },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
      expect(body.messages[2]).toEqual({ role: "assistant", content: "Hello" });
      expect(body.messages[3]).toEqual({ role: "user", content: "How are you?" });
    });
  });
});
