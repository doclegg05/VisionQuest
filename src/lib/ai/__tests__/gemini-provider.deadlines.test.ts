/**
 * Deadline regression suite for the cloud provider.
 *
 * GeminiProvider had no wall clock of any kind: `withTransientRetry` fires
 * only on classified errors (429/5xx/network), never on a hang, and the SDK
 * imposes no timeout unless one is handed to it. Meanwhile the chat route
 * sends an SSE heartbeat every 15s, so a turn whose upstream never answers
 * keeps its connection — and the student's screen — alive indefinitely.
 *
 * The local provider already solved the same problem by aborting before
 * Cloudflare's 100s 524 threshold, "so callers get a clear timeout error
 * instead of a cryptic 524" (ollama-provider.ts). These tests hold the cloud
 * path to that standard on all three windows: establishment, whole-request,
 * and inter-chunk.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../gemini-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

const encoder = new TextEncoder();

function sseChunk(text: string): string {
  return (
    "data: " +
    JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" } }] }) +
    "\r\n\r\n"
  );
}

/** A response whose body emits `texts`, then holds the stream open forever. */
function streamThenSilence(texts: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of texts) controller.enqueue(encoder.encode(sseChunk(text)));
      // Deliberately never closed — this is the stall.
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** A healthy stream whose chunks arrive `gapMs` apart, then closes. */
function streamWithGaps(texts: string[], gapMs: number): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const text of texts) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        controller.enqueue(encoder.encode(sseChunk(text)));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Never resolves and never rejects — the shape of a black-holed request. */
function hangForever(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

function signalOfCall(index: number): AbortSignal | undefined {
  return (mockFetch.mock.calls[index].arguments[1] as RequestInit | undefined)?.signal ?? undefined;
}

const TOOLS = [
  {
    name: "lookup_thing",
    description: "Look up a thing.",
    parameters: { type: "object" as const, properties: {} },
  },
];

describe("GeminiProvider deadlines", { concurrency: false }, () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in GeminiProvider test");
    });
  });

  describe("non-streaming hard deadline", () => {
    it("generateResponse rejects instead of hanging on a black-holed request", async () => {
      mockFetch.mock.mockImplementation(hangForever);
      const provider = new GeminiProvider("test-key", { requestTimeoutMs: 60 });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /timed out/i,
      );
    });

    it("generateStructuredResponse rejects too", async () => {
      mockFetch.mock.mockImplementation(hangForever);
      const provider = new GeminiProvider("test-key", { requestTimeoutMs: 60 });

      await assert.rejects(
        provider.generateStructuredResponse("sys", [{ role: "user", content: "Hi" }]),
        /timed out/i,
      );
    });

    /**
     * A hang is a transient failure, so it must be classified as retryable —
     * nothing reached the caller and re-issuing is safe. Three attempts is
     * the existing ladder (RETRY_DELAYS_MS), which also bounds the total.
     */
    it("classifies the timeout as transient and retries the whole ladder", async () => {
      mockFetch.mock.mockImplementation(hangForever);
      const provider = new GeminiProvider("test-key", { requestTimeoutMs: 60 });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /timed out/i,
      );

      assert.equal(mockFetch.mock.callCount(), 3);
    });

    it("aborts the in-flight request so the socket is not leaked", async () => {
      mockFetch.mock.mockImplementation(hangForever);
      const provider = new GeminiProvider("test-key", { requestTimeoutMs: 60 });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
      );

      assert.equal(signalOfCall(0)?.aborted, true);
    });
  });

  describe("streaming establishment deadline", () => {
    it("streamResponse rejects when the first chunk never arrives", async () => {
      mockFetch.mock.mockImplementation(hangForever);
      const provider = new GeminiProvider("test-key", { streamEstablishTimeoutMs: 60 });

      await assert.rejects(async () => {
        for await (const _ of provider.streamResponse("sys", [
          { role: "user", content: "Hi" },
        ])) {
          // drain
        }
      }, /timed out/i);

      assert.equal(mockFetch.mock.callCount(), 3);
    });

    it("streamWithTools rejects when a hop never establishes", async () => {
      mockFetch.mock.mockImplementation(hangForever);
      const provider = new GeminiProvider("test-key", { streamEstablishTimeoutMs: 60 });

      await assert.rejects(async () => {
        for await (const _ of provider.streamWithTools(
          "sys",
          [{ role: "user", content: "Hi" }],
          TOOLS,
          async () => ({ response: {}, summary: "", status: "success" as const }),
        )) {
          // drain
        }
      }, /timed out/i);
    });
  });

  describe("inter-chunk stall deadline", () => {
    it("streamResponse rejects when the stream goes quiet after its first chunk", async () => {
      mockFetch.mock.mockImplementationOnce(async () => streamThenSilence(["You've "]));
      const provider = new GeminiProvider("test-key", { streamStallTimeoutMs: 120 });

      const chunks: string[] = [];
      await assert.rejects(async () => {
        for await (const chunk of provider.streamResponse("sys", [
          { role: "user", content: "Hi" },
        ])) {
          chunks.push(chunk);
        }
      }, /timed out/i);

      assert.deepEqual(chunks, ["You've "]);
      // Yielded output can't be replayed, so a stall must never be retried.
      assert.equal(mockFetch.mock.callCount(), 1);
      assert.equal(signalOfCall(0)?.aborted, true);
    });

    it("streamWithTools rejects when a hop stalls mid-stream", async () => {
      mockFetch.mock.mockImplementationOnce(async () => streamThenSilence(["Checking"]));
      const provider = new GeminiProvider("test-key", { streamStallTimeoutMs: 120 });

      await assert.rejects(async () => {
        for await (const _ of provider.streamWithTools(
          "sys",
          [{ role: "user", content: "Hi" }],
          TOOLS,
          async () => ({ response: {}, summary: "", status: "success" as const }),
        )) {
          // drain
        }
      }, /timed out/i);

      assert.equal(mockFetch.mock.callCount(), 1);
    });

    /** A slow-but-alive stream must not be killed: gaps under the limit are fine. */
    it("does not trip on a healthy stream whose chunks arrive slowly", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        streamWithGaps(["You", "'ve got this"], 40),
      );
      const provider = new GeminiProvider("test-key", { streamStallTimeoutMs: 300 });

      const chunks: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        chunks.push(chunk);
      }

      assert.equal(chunks.join(""), "You've got this");
    });
  });
});
