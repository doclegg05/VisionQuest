/**
 * Ollama endpoints talk to native /api/chat, with truncate:false.
 *
 * Ollama's OpenAI-compatible /v1/chat/completions ignores `num_ctx` and
 * `truncate` (measured on Ollama 0.40.3, 2026-10-15). A call there runs at
 * the host's default context, 4,096 tokens under 24 GiB of VRAM, and a
 * prompt longer than the context is cut from the front with HTTP 200. Sage's
 * prompt is 7,000 to 7,500 tokens and its front holds the identity,
 * guardrails and crisis rules, so the model answered without them and nothing
 * failed.
 *
 * Native /api/chat honors `options.num_ctx`, and with `truncate: false` it
 * refuses an oversize prompt with a 400 instead of cutting it. These tests
 * pin both halves: the surface, and that the refusal reaches the caller as an
 * error (which the chat route turns into AI_STREAM_FAILED with the 988 block)
 * rather than as an empty or partial reply.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";
import type { ToolDeclaration, ToolStreamEvent } from "../types";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

const encoder = new TextEncoder();

/** The body Ollama 0.40.3 returned for a 4,246-token prompt at num_ctx 2048. */
const EXCEEDS_CONTEXT_BODY = JSON.stringify({
  error: JSON.stringify({
    error: {
      code: 400,
      message:
        "request (4246 tokens) exceeds the available context size (2048 tokens), try increasing it",
      type: "exceed_context_size_error",
      n_prompt_tokens: 4246,
      n_ctx: 2048,
    },
  }),
});

const TOOLS: ToolDeclaration[] = [
  {
    name: "lookup_program_info",
    description: "Look up a program fact.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

function urlOf(callIndex: number): string {
  return String(mockFetch.mock.calls[callIndex].arguments[0]);
}

function bodyOf(callIndex: number): Record<string, unknown> {
  return JSON.parse(
    (mockFetch.mock.calls[callIndex].arguments[1] as RequestInit).body as string,
  );
}

function nativeJson(content: string): Response {
  return new Response(
    JSON.stringify({
      message: { role: "assistant", content },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function streamOf(lines: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function nativeStream(content: string): Response {
  return streamOf([
    `${JSON.stringify({ message: { role: "assistant", content }, done: false })}\n`,
    `${JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 5 })}\n`,
  ]);
}

function exceedsContext(): Response {
  return new Response(EXCEEDS_CONTEXT_BODY, {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * What scripts/ollama-relay.mjs sends when Ollama answers a streaming request
 * with a non-200: headers and a heartbeat go out before Ollama replies, so the
 * status can only travel inside the 200 stream.
 */
function relayWrappedRejection(status = 400): Response {
  return streamOf([
    ": heartbeat\n\n",
    `data: ${JSON.stringify({ error: `Ollama returned ${status}` })}\n\n`,
  ]);
}

function provider(): OllamaProvider {
  return new OllamaProvider("http://localhost:11434", "gemma4:e2b-it-qat", { authMode: "none" });
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

const USER = [{ role: "user" as const, content: "hi" }];

describe("OllamaProvider on an Ollama endpoint", { concurrency: false }, () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
  });

  describe("uses native /api/chat with truncate:false from the first request", () => {
    it("generateResponse", async () => {
      mockFetch.mock.mockImplementation(async () => nativeJson("hello"));
      assert.equal(await provider().generateResponse("system", USER), "hello");
      assert.equal(mockFetch.mock.calls.length, 1);
      assert.match(urlOf(0), /\/api\/chat$/);
      assert.equal(bodyOf(0).truncate, false);
      assert.deepEqual((bodyOf(0).options as Record<string, unknown>).num_ctx, 8192);
    });

    it("generateStructuredResponse", async () => {
      mockFetch.mock.mockImplementation(async () => nativeJson('{"ok":true}'));
      await provider().generateStructuredResponse("system", USER);
      assert.equal(mockFetch.mock.calls.length, 1);
      assert.match(urlOf(0), /\/api\/chat$/);
      assert.equal(bodyOf(0).truncate, false);
      assert.equal(bodyOf(0).format, "json");
    });

    it("streamResponse", async () => {
      mockFetch.mock.mockImplementation(async () => nativeStream("hello"));
      assert.deepEqual(await drain(provider().streamResponse("system", USER)), ["hello"]);
      assert.equal(mockFetch.mock.calls.length, 1);
      assert.match(urlOf(0), /\/api\/chat$/);
      assert.equal(bodyOf(0).truncate, false);
    });

    it("streamWithTools", async () => {
      mockFetch.mock.mockImplementation(async () => nativeStream("hello"));
      const events = await drain(
        provider().streamWithTools("system", USER, TOOLS, async () => ({
          status: "success",
          summary: "",
          response: {},
        })),
      );
      assert.deepEqual(events.at(-1), { kind: "done", reason: "complete" });
      assert.equal(mockFetch.mock.calls.length, 1);
      assert.match(urlOf(0), /\/api\/chat$/);
      assert.equal(bodyOf(0).truncate, false);
      assert.ok(Array.isArray(bodyOf(0).tools));
    });

    it("sends the configured ai_provider_num_ctx to native", async () => {
      mockFetch.mock.mockImplementation(async () => nativeJson("hello"));
      const p = new OllamaProvider("http://localhost:11434", "gemma4:e2b-it-qat", {
        authMode: "none",
        numCtx: 16384,
      });
      await p.generateResponse("system", USER);
      assert.equal((bodyOf(0).options as Record<string, unknown>).num_ctx, 16384);
    });
  });

  describe("an oversize prompt is an error, never an empty or cut reply", () => {
    it("generateResponse throws on Ollama's 400 and does not retry on /v1", async () => {
      mockFetch.mock.mockImplementation(async () => exceedsContext());
      await assert.rejects(provider().generateResponse("system", USER), /400/);
      assert.equal(mockFetch.mock.calls.length, 1);
      assert.match(urlOf(0), /\/api\/chat$/);
    });

    it("generateStructuredResponse throws on Ollama's 400", async () => {
      mockFetch.mock.mockImplementation(async () => exceedsContext());
      await assert.rejects(provider().generateStructuredResponse("system", USER), /400/);
      assert.equal(mockFetch.mock.calls.length, 1);
    });

    it("streamResponse throws on a direct 400 without retrying or switching surface", async () => {
      mockFetch.mock.mockImplementation(async () => exceedsContext());
      await assert.rejects(drain(provider().streamResponse("system", USER)), /400/);
      assert.equal(mockFetch.mock.calls.length, 1);
      assert.match(urlOf(0), /\/api\/chat$/);
    });

    it("streamResponse throws on the relay's in-stream rejection", async () => {
      mockFetch.mock.mockImplementation(async () => relayWrappedRejection(400));
      await assert.rejects(
        drain(provider().streamResponse("system", USER)),
        /Ollama returned 400/,
      );
      assert.equal(mockFetch.mock.calls.length, 1);
    });

    it("streamWithTools throws on a direct 400", async () => {
      mockFetch.mock.mockImplementation(async () => exceedsContext());
      const turn = provider().streamWithTools("system", USER, TOOLS, async () => ({
        status: "success",
        summary: "",
        response: {},
      }));
      await assert.rejects(drain(turn), /400/);
      assert.equal(mockFetch.mock.calls.length, 1);
    });

    it("streamWithTools throws on the relay's in-stream rejection instead of ending the turn empty", async () => {
      mockFetch.mock.mockImplementation(async () => relayWrappedRejection(400));
      const events: ToolStreamEvent[] = [];
      const turn = (async () => {
        for await (const event of provider().streamWithTools("system", USER, TOOLS, async () => ({
          status: "success",
          summary: "",
          response: {},
        }))) {
          events.push(event);
        }
      })();
      await assert.rejects(turn, /Ollama returned 400/);
      assert.equal(events.length, 0, "no text and no done(complete) before the error");
    });

    it("names the context window in the error so the cause is findable", async () => {
      mockFetch.mock.mockImplementation(async () => exceedsContext());
      await assert.rejects(provider().generateResponse("system", USER), /context/i);
      mockFetch.mock.mockImplementation(async () => relayWrappedRejection(400));
      await assert.rejects(drain(provider().streamResponse("system", USER)), /context/i);
    });
  });

  it("still retries a transient relay startup error on native", async () => {
    let calls = 0;
    mockFetch.mock.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? relayWrappedRejection(503) : nativeStream("hello");
    });
    assert.deepEqual(await drain(provider().streamResponse("system", USER)), ["hello"]);
    assert.equal(mockFetch.mock.calls.length, 2);
    assert.match(urlOf(1), /\/api\/chat$/);
  });
});

describe("trusted prompt prefix boundaries", { concurrency: false }, () => {
  beforeEach(() => mockFetch.mock.resetCalls());
  const prompt = "Trusted instructions\n\nStudent-specific context";
  const boundary = "Trusted instructions".length;
  const expected = [
    { role: "system", content: prompt.slice(0, boundary) },
    { role: "system", content: prompt.slice(boundary) },
    ...USER,
  ];
  it("preserves the complete prompt and user input on every native entry point", async () => {
    mockFetch.mock.mockImplementation(async () => nativeJson("hello"));
    await provider().generateResponse(prompt, USER, undefined, { systemPrefixLength: boundary });
    assert.deepEqual(bodyOf(0).messages, expected);
    await provider().generateStructuredResponse(prompt, USER, undefined, { systemPrefixLength: boundary });
    assert.deepEqual(bodyOf(1).messages, expected);
    mockFetch.mock.mockImplementation(async () => nativeStream("hello"));
    await drain(provider().streamResponse(prompt, USER, undefined, { systemPrefixLength: boundary }));
    assert.deepEqual(bodyOf(2).messages, expected);
    await drain(provider().streamWithTools(prompt, USER, TOOLS, async () => ({ ok: true }), { systemPrefixLength: boundary }));
    assert.deepEqual(bodyOf(3).messages, expected);
    await drain(provider().streamWithTools(prompt, USER, [], async () => ({ ok: true }), { systemPrefixLength: boundary }));
    assert.deepEqual(bodyOf(4).messages, expected);
  });
  it("ignores invalid boundaries without dropping instructions", async () => {
    mockFetch.mock.mockImplementation(async () => nativeJson("hello"));
    for (const systemPrefixLength of [-1, 0, prompt.length, prompt.length + 1, NaN, 1.5]) {
      await provider().generateResponse(prompt, USER, undefined, { systemPrefixLength });
      assert.deepEqual(bodyOf(mockFetch.mock.calls.length - 1).messages, [{ role: "system", content: prompt }, ...USER]);
    }
  });
});
