/**
 * Tool-call identity through streamWithTools.
 *
 * The callId on every tool_call event is the model-supplied id from the
 * wire, and the handler receives that same id, so the agent loop can match
 * results to calls by id instead of by array position (review finding
 * SAGE-02 / VQ-R-010).
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ToolCallHandler, ToolStreamEvent } from "../types";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

const encoder = new TextEncoder();

type ToolCallEvent = Extract<ToolStreamEvent, { kind: "tool_call" }>;
type ToolResultEvent = Extract<ToolStreamEvent, { kind: "tool_result" }>;

/** OpenAI-compatible SSE body: each payload as a `data:` line, then [DONE]. */
function sse(payloads: unknown[]): Response {
  const chunks = [
    ...payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`),
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

const TOOLS = ["lookup_a", "lookup_b"].map((name) => ({
  name,
  description: `Look up ${name}.`,
  parameters: {
    type: "object" as const,
    properties: { id: { type: "string" as const } },
  },
}));

describe("OllamaProvider tool call ids", { concurrency: false }, () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in OllamaProvider test");
    });
    provider = new OllamaProvider("http://localhost:11434", "test-model");
  });

  it("hands each parallel handler the model-supplied id its tool_call event carried", async () => {
    let calls = 0;
    mockFetch.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        // Hop 1: two tool calls in one delta, ids assigned by the model.
        return sse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_a", function: { name: "lookup_a", arguments: '{"id":"1"}' } },
                    { index: 1, id: "call_b", function: { name: "lookup_b", arguments: "{}" } },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ]);
      }
      // Hop 2: plain text, no further calls.
      return sse([{ choices: [{ delta: { content: "done" } }] }]);
    });

    const handlerCalls: Array<{ callId: string | undefined; name: string }> = [];
    const onToolCall: ToolCallHandler = async (call) => {
      handlerCalls.push({ callId: call.callId, name: call.name });
      return { response: { ok: true }, summary: "ok", status: "success" as const };
    };

    const events: ToolStreamEvent[] = [];
    for await (const event of provider.streamWithTools(
      "sys",
      [{ role: "user", content: "Hi" }],
      TOOLS,
      onToolCall,
    )) {
      events.push(event);
    }

    const toolCalls = events.filter((e): e is ToolCallEvent => e.kind === "tool_call");
    assert.deepEqual(
      toolCalls.map((c) => c.callId),
      ["call_a", "call_b"],
      "tool_call callIds are the model-supplied ids from the wire",
    );
    for (const ev of toolCalls) {
      const handled = handlerCalls.find((h) => h.name === ev.name);
      assert.ok(handled, `handler ran for ${ev.name}`);
      assert.equal(
        handled.callId,
        ev.callId,
        `${ev.name}: the handler must receive the callId its tool_call event carried`,
      );
    }
    const results = events.filter((e): e is ToolResultEvent => e.kind === "tool_result");
    assert.deepEqual(
      results.map((r) => r.callId),
      ["call_a", "call_b"],
      "tool_result callIds mirror the tool_call callIds",
    );
  });
});
