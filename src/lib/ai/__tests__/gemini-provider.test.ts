import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../gemini-provider";

// Mock fetch to intercept Gemini SDK network calls
const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

/** Build a Gemini API JSON response for non-streaming calls. */
function geminiResponse(text: string) {
  return Response.json({
    candidates: [{ content: { parts: [{ text }], role: "model" } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  });
}

/** Build a Gemini API SSE response for streaming calls. */
function geminiStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const parts = chunks.map((text) =>
    "data: " +
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }], role: "model" } }],
    }) +
    "\r\n\r\n",
  );

  const stream = new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("GeminiProvider", () => {
  const provider = new GeminiProvider("test-api-key");

  beforeEach(() => {
    mockFetch.mock.resetCalls();
  });

  it("generateResponse returns text from Gemini", async () => {
    mockFetch.mock.mockImplementationOnce(async () =>
      geminiResponse("Gemini says hello"),
    );

    const result = await provider.generateResponse("Be helpful.", [
      { role: "user", content: "Hi" },
    ]);

    assert.equal(result, "Gemini says hello");
    const url = String(mockFetch.mock.calls[0].arguments[0]);
    assert.ok(url.includes("generateContent"), "should call generateContent");
  });

  it("streamResponse yields chunks from Gemini stream", async () => {
    mockFetch.mock.mockImplementationOnce(async () =>
      geminiStreamResponse(["chunk1", "chunk2"]),
    );

    const chunks: string[] = [];
    for await (const chunk of provider.streamResponse("sys", [
      { role: "user", content: "Hi" },
    ])) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["chunk1", "chunk2"]);
    const url = String(mockFetch.mock.calls[0].arguments[0]);
    assert.ok(url.includes("streamGenerateContent"), "should call streamGenerateContent");
  });

  it("generateStructuredResponse returns JSON text", async () => {
    mockFetch.mock.mockImplementationOnce(async () =>
      geminiResponse('{"goals_found":[]}'),
    );

    const result = await provider.generateStructuredResponse("Extract.", [
      { role: "user", content: "text" },
    ]);

    assert.equal(result, '{"goals_found":[]}');
  });

  it("throws on empty messages", async () => {
    await assert.rejects(
      provider.generateResponse("sys", []),
      /messages array must not be empty/,
    );
  });

  describe("onUsage", () => {
    it("generateResponse reports real usageMetadata as source 'provider'", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        geminiResponse("Gemini says hello"),
      );

      const usages: Array<{ inputTokens: number; outputTokens: number; totalTokens: number; source: string }> = [];
      await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ], (usage) => usages.push(usage));

      assert.equal(usages.length, 1);
      assert.deepEqual(usages[0], {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        source: "provider",
      });
    });

    it("streamResponse falls back to the estimator when usageMetadata is absent", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        geminiStreamResponse(["chunk1", "chunk2"]),
      );

      const usages: Array<{ inputTokens: number; outputTokens: number; totalTokens: number; source: string }> = [];
      const chunks: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ], (usage) => usages.push(usage))) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["chunk1", "chunk2"]);
      assert.equal(usages.length, 1);
      assert.equal(usages[0].source, "estimated");
      assert.ok(usages[0].outputTokens > 0, "should estimate output tokens from streamed text");
    });

    it("generateStructuredResponse reports real usageMetadata as source 'provider'", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        geminiResponse('{"goals_found":[]}'),
      );

      const usages: Array<{ source: string }> = [];
      await provider.generateStructuredResponse("Extract.", [
        { role: "user", content: "text" },
      ], (usage) => usages.push(usage));

      assert.equal(usages.length, 1);
      assert.equal(usages[0].source, "provider");
    });

    it("does not call onUsage-less callers differently (non-breaking)", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        geminiResponse("no usage callback"),
      );

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "no usage callback");
    });
  });
});
