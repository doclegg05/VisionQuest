/**
 * Thinking-model regression suite.
 *
 * Reasoning ("thinking") models draw their reasoning tokens from the SAME
 * output budget as visible content. On a long system prompt — the real Sage
 * prompt is ~20k chars — a model like gemma4:26b-a4b-it-qat spends the whole
 * 768-token budget reasoning and emits zero visible content. The provider
 * used to read only `message.content` and hand callers "", so every Sage
 * eval scenario logged "empty reply" with nothing wrong in the scenarios.
 *
 * Two invariants keep that from recurring:
 *   1. Reasoning is disabled by default, so the budget buys visible content.
 *   2. A truncated turn that produced no visible content THROWS. Silence is
 *      what let this ship unnoticed.
 *
 * Endpoint-specific detail these tests lock in: the disable knob differs per
 * API surface, and each surface silently ignores the other's. Verified
 * against Ollama 0.32.4 — `/v1/chat/completions` honors only
 * `reasoning_effort: "none"`, `/api/chat` honors only `think: false`.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

const encoder = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function bodyOf(callIndex: number): Record<string, unknown> {
  return JSON.parse(
    (mockFetch.mock.calls[callIndex].arguments[1] as RequestInit).body as string,
  );
}

/** First call 404s the OpenAI path so the provider falls through to native. */
function nativeAfter404(nativeResponse: () => Response): void {
  let calls = 0;
  mockFetch.mock.mockImplementation(async () => {
    calls += 1;
    if (calls === 1) return new Response("Not Found", { status: 404 });
    return nativeResponse();
  });
}

describe("OllamaProvider thinking models", { concurrency: false }, () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in OllamaProvider test");
    });
    provider = new OllamaProvider("http://localhost:11434", "gemma4:26b-a4b-it-qat");
  });

  describe("reasoning disabled by default", () => {
    it("sends reasoning_effort:none on the OpenAI-compat path", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ message: { content: "ok" } }] }),
      );

      await provider.generateResponse("sys", [{ role: "user", content: "Hi" }]);

      assert.equal(bodyOf(0).reasoning_effort, "none");
    });

    it("sends think:false on the native path", async () => {
      nativeAfter404(() => Response.json({ message: { content: "ok" } }));

      await provider.generateResponse("sys", [{ role: "user", content: "Hi" }]);

      assert.equal(bodyOf(1).think, false);
    });

    it("disables reasoning for structured JSON generation", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ message: { content: "{}" } }] }),
      );

      await provider.generateStructuredResponse("sys", [{ role: "user", content: "Hi" }]);

      assert.equal(bodyOf(0).reasoning_effort, "none");
    });

    it("disables reasoning for streaming", async () => {
      mockFetch.mock.mockImplementationOnce(
        async () =>
          new Response(
            streamOf([
              `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`,
              "data: [DONE]\n\n",
            ]),
            { status: 200 },
          ),
      );

      for await (const _ of provider.streamResponse("sys", [{ role: "user", content: "Hi" }])) {
        // drain
      }

      assert.equal(bodyOf(0).reasoning_effort, "none");
    });

    it("disables reasoning for tool streaming", async () => {
      mockFetch.mock.mockImplementationOnce(
        async () =>
          new Response(
            streamOf([
              `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`,
              "data: [DONE]\n\n",
            ]),
            { status: 200 },
          ),
      );

      const tools = [
        {
          name: "noop",
          description: "does nothing",
          parameters: { type: "object" as const, properties: {} },
        },
      ];
      for await (const _ of provider.streamWithTools(
        "sys",
        [{ role: "user", content: "Hi" }],
        tools,
        async () => ({ response: {}, summary: "", status: "success" as const }),
      )) {
        // drain
      }

      assert.equal(bodyOf(0).reasoning_effort, "none");
    });
  });

  describe("reasoning opt-in", () => {
    it("omits reasoning_effort on the OpenAI path when reasoning is enabled", async () => {
      const reasoningProvider = new OllamaProvider(
        "http://localhost:11434",
        "gemma4:26b-a4b-it-qat",
        { authMode: "none", reasoning: true },
      );
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ message: { content: "ok" } }] }),
      );

      await reasoningProvider.generateResponse("sys", [{ role: "user", content: "Hi" }]);

      assert.equal("reasoning_effort" in bodyOf(0), false);
    });

    it("sends think:true on the native path when reasoning is enabled", async () => {
      const reasoningProvider = new OllamaProvider(
        "http://localhost:11434",
        "gemma4:26b-a4b-it-qat",
        { authMode: "none", reasoning: true },
      );
      nativeAfter404(() => Response.json({ message: { content: "ok" } }));

      await reasoningProvider.generateResponse("sys", [{ role: "user", content: "Hi" }]);

      assert.equal(bodyOf(1).think, true);
    });

    /**
     * LM Studio / vLLM / llama.cpp expose only /v1 and their reasoning
     * controls vary; an unknown value can 400 the request. Ollama's own
     * knobs must never leak to them.
     */
    it("never sends reasoning controls to a generic OpenAI-only endpoint", async () => {
      const genericProvider = new OllamaProvider(
        "http://localhost:1234",
        "some-model",
        { authMode: "none", apiStyle: "openai" },
      );
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ message: { content: "ok" } }] }),
      );

      await genericProvider.generateResponse("sys", [{ role: "user", content: "Hi" }]);

      const body = bodyOf(0);
      assert.equal("reasoning_effort" in body, false);
      assert.equal("think" in body, false);
    });
  });

  describe("truncated with no visible content throws instead of returning ''", () => {
    it("generateResponse throws on the OpenAI-compat path", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [
            {
              finish_reason: "length",
              message: { content: "", reasoning: "thinking about it".repeat(80) },
            },
          ],
          usage: { prompt_tokens: 4579, completion_tokens: 768 },
        }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /reasoning/i,
      );
    });

    it("generateResponse throws on the native path", async () => {
      nativeAfter404(() =>
        Response.json({
          message: { content: "", thinking: "thinking about it".repeat(80) },
          done: true,
          done_reason: "length",
          prompt_eval_count: 4579,
          eval_count: 768,
        }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /reasoning/i,
      );
    });

    it("generateStructuredResponse throws rather than returning unparseable ''", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [
            { finish_reason: "length", message: { content: "", reasoning: "x".repeat(200) } },
          ],
        }),
      );

      await assert.rejects(
        provider.generateStructuredResponse("sys", [{ role: "user", content: "Hi" }]),
        /reasoning/i,
      );
    });

    /** Truncated-but-present content is still usable — must not throw. */
    it("returns truncated content when the model did emit some", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [
            {
              finish_reason: "length",
              message: { content: "Here's what I'd sugg", reasoning: "x".repeat(200) },
            },
          ],
        }),
      );

      const result = await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "Here's what I'd sugg");
    });

    /**
     * An empty reply that stopped normally is a different failure — it must
     * still fail, and must not be mislabeled as the reasoning-budget one.
     *
     * This case used to assert `result === ""`, which pinned the silence: a
     * normally-stopped empty turn is also how an undeclared tool call comes
     * back on the native surface, and passing it through is what hid that bug
     * for two sessions. See ollama-provider.tool-call-silence.test.ts.
     */
    it("does not blame reasoning when the turn stopped normally", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ finish_reason: "stop", message: { content: "" } }] }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        (error: Error) => {
          assert.doesNotMatch(error.message, /reasoning/i);
          return true;
        },
      );
    });
  });

  describe("streaming a reasoning-only turn", () => {
    it("reports the reasoning budget, not a generic empty stream", async () => {
      nativeAfter404(
        () =>
          new Response(
            streamOf([
              JSON.stringify({ message: { thinking: "Let me consider…" }, done: false }) + "\n",
              JSON.stringify({ message: { thinking: " still considering…" }, done: false }) + "\n",
              JSON.stringify({
                message: { content: "" },
                done: true,
                done_reason: "length",
                eval_count: 768,
              }) + "\n",
            ]),
            { status: 200 },
          ),
      );

      await assert.rejects(async () => {
        for await (const _ of provider.streamResponse("sys", [
          { role: "user", content: "Hi" },
        ])) {
          // drain
        }
      }, /reasoning/i);
    });

    it("still yields visible content when reasoning precedes it", async () => {
      nativeAfter404(
        () =>
          new Response(
            streamOf([
              JSON.stringify({ message: { thinking: "Let me consider…" }, done: false }) + "\n",
              JSON.stringify({ message: { content: "You've got this" }, done: false }) + "\n",
              JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop" }) + "\n",
            ]),
            { status: 200 },
          ),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["You've got this"]);
    });

    /**
     * The reasoning channel must never reach the student: it restates the
     * system prompt's meta-instructions ("Role: Sage (Bold, supportive,
     * practical mentor)", "Structure: Reflect before advising"), which is
     * exactly what the eval `neverContain` canaries exist to keep out.
     */
    it("never yields reasoning text as reply content", async () => {
      nativeAfter404(
        () =>
          new Response(
            streamOf([
              JSON.stringify({
                message: { thinking: "Role: Sage (Bold, supportive, practical mentor)" },
                done: false,
              }) + "\n",
              JSON.stringify({ message: { content: "Nerves are normal." }, done: false }) + "\n",
              JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop" }) + "\n",
            ]),
            { status: 200 },
          ),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        chunks.push(chunk);
      }

      assert.equal(chunks.join("").includes("Role: Sage"), false);
    });
  });
});
