/**
 * Mid-stream stall regression suite.
 *
 * The first-content deadline only guards the window BEFORE the model's first
 * token. After that the read loop was a bare `reader.read()` with no clock on
 * it: one token followed by silence held the turn open until the caller gave
 * up, and the chat route's 15s SSE heartbeat kept the socket alive the whole
 * time — so a wedged model looked exactly like a slow one, forever.
 *
 * The guard is an inter-DELTA timer, not an inter-chunk one: relay heartbeats
 * and keep-alive frames arrive on schedule while the model produces nothing,
 * so only content, reasoning, or a tool-call delta may reset it.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

const encoder = new TextEncoder();

interface StallingStream {
  body: ReadableStream<Uint8Array>;
  /** Resolves when something cancels the reader — proves we don't leak it. */
  cancelled: Promise<string>;
}

/** A stream that emits `chunks`, then holds the connection open forever. */
function streamThenSilence(chunks: string[]): StallingStream {
  let signalCancelled: (reason: string) => void = () => undefined;
  const cancelled = new Promise<string>((resolve) => {
    signalCancelled = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      // Deliberately never closed.
    },
    cancel(reason) {
      signalCancelled(String(reason));
    },
  });
  return { body, cancelled };
}

/** A healthy stream whose chunks arrive `gapMs` apart, then closes. */
function streamWithGaps(chunks: string[], gapMs: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

const TOOLS = [
  {
    name: "lookup_thing",
    description: "Look up a thing.",
    parameters: { type: "object" as const, properties: {} },
  },
];

describe("OllamaProvider mid-stream stall", { concurrency: false }, () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in OllamaProvider test");
    });
  });

  /** Ollama endpoints stream native NDJSON; `openai` servers stream SSE. */
  function stallingProvider(stallMs: number, apiStyle?: "openai"): OllamaProvider {
    return new OllamaProvider("http://localhost:11434", "gemma4:latest", {
      authMode: "none",
      streamStallTimeoutMs: stallMs,
      ...(apiStyle ? { apiStyle } : {}),
    });
  }

  it("streamResponse fails once the model goes quiet after its first token", async () => {
    const stream = streamThenSilence([
      JSON.stringify({ message: { content: "You've " }, done: false }) + "\n",
    ]);
    mockFetch.mock.mockImplementationOnce(
      async () => new Response(stream.body, { status: 200 }),
    );

    const provider = stallingProvider(120);
    const chunks: string[] = [];
    await assert.rejects(async () => {
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        chunks.push(chunk);
      }
    }, /timed out/i);

    assert.deepEqual(chunks, ["You've "]);
    assert.match(await stream.cancelled, /stall/i);
  });

  it("streamResponse fails on a stalled OpenAI-compatible stream too", async () => {
    const stream = streamThenSilence([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "You've " } }] })}\n\n`,
    ]);
    mockFetch.mock.mockImplementationOnce(
      async () => new Response(stream.body, { status: 200 }),
    );

    const provider = stallingProvider(120, "openai");
    const chunks: string[] = [];
    await assert.rejects(async () => {
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        chunks.push(chunk);
      }
    }, /timed out/i);

    assert.deepEqual(chunks, ["You've "]);
  });

  it("streamWithTools fails when a hop stalls after its first token", async () => {
    const stream = streamThenSilence([
      JSON.stringify({ message: { content: "Checking" }, done: false }) + "\n",
    ]);
    mockFetch.mock.mockImplementationOnce(
      async () => new Response(stream.body, { status: 200 }),
    );

    const provider = stallingProvider(120);
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

    assert.match(await stream.cancelled, /stall/i);
  });

  /** A slow-but-alive model must not be killed: gaps under the limit are fine. */
  it("does not trip on a healthy stream whose chunks arrive slowly", async () => {
    mockFetch.mock.mockImplementationOnce(
      async () =>
        new Response(
          streamWithGaps(
            [
              JSON.stringify({ message: { content: "You" }, done: false }) + "\n",
              JSON.stringify({ message: { content: "'ve got this" }, done: false }) + "\n",
              JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop" }) + "\n",
            ],
            40,
          ),
          { status: 200 },
        ),
    );

    const provider = stallingProvider(300);
    const chunks: string[] = [];
    for await (const chunk of provider.streamResponse("sys", [
      { role: "user", content: "Hi" },
    ])) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "You've got this");
  });
});
