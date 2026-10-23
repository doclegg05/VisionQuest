/**
 * Tool-call identity through streamWithTools.
 *
 * The callId on every tool_call event is the model-supplied id from the
 * wire, and the handler receives that same id, so the agent loop can match
 * results to calls by id instead of by array position (review finding
 * SAGE-02 / VQ-R-010).
 *
 * The wire ids only exist on /v1 (`apiStyle: "openai"` servers). Native
 * /api/chat, which Ollama endpoints use, sends no ids, so the provider mints
 * one per call; the same id must still reach the event, the handler and the
 * result.
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

/** Native /api/chat stream body: one JSON object per line. */
function ndjson(payloads: unknown[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const payload of payloads) {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        }
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
    provider = new OllamaProvider("http://localhost:1234", "test-model", {
      authMode: "none",
      apiStyle: "openai",
    });
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

    const secondBody = JSON.parse(String(mockFetch.mock.calls[1].arguments[1]?.body));
    const assistantHistory = secondBody.messages.find((message: { role: string; tool_calls?: unknown[] }) => message.role === "assistant" && message.tool_calls);
    assert.deepEqual(assistantHistory.tool_calls.map((call: { function: { arguments: unknown } }) => call.function.arguments), ['{"id":"1"}', "{}"]);

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

  it("carries one minted id per native call through event, handler and result", async () => {
    let calls = 0;
    mockFetch.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return ndjson([
          {
            message: {
              content: "",
              tool_calls: [
                { function: { name: "lookup_a", arguments: { id: "1" } } },
                { function: { name: "lookup_b", arguments: {} } },
              ],
            },
            done: false,
          },
          { message: { content: "" }, done: true, done_reason: "stop" },
        ]);
      }
      return ndjson([
        { message: { content: "done" }, done: false },
        { message: { content: "" }, done: true, done_reason: "stop" },
      ]);
    });

    const native = new OllamaProvider("http://localhost:11434", "test-model", { authMode: "none" });
    const handlerCalls: Array<{ callId: string | undefined; name: string }> = [];
    const events: ToolStreamEvent[] = [];
    for await (const event of native.streamWithTools(
      "static context",
      [{ role: "user", content: "Hi" }],
      TOOLS,
      async (call) => {
        handlerCalls.push({ callId: call.callId, name: call.name });
        return { response: { ok: true }, summary: "ok", status: "success" as const };
      },
      { systemPrefixLength: 6 },
    )) {
      events.push(event);
    }

    const secondBody = JSON.parse(String(mockFetch.mock.calls[1].arguments[1]?.body));
    assert.deepEqual(secondBody.messages.slice(0, 2), [{ role: "system", content: "static" }, { role: "system", content: " context" }]);
    const assistantHistory = secondBody.messages.find((message: { role: string; tool_calls?: unknown[] }) => message.role === "assistant" && message.tool_calls);
    assert.deepEqual(assistantHistory.tool_calls.map((call: { function: { arguments: unknown } }) => call.function.arguments), [{ id: "1" }, {}]);

    const toolCalls = events.filter((e): e is ToolCallEvent => e.kind === "tool_call");
    const results = events.filter((e): e is ToolResultEvent => e.kind === "tool_result");
    assert.equal(toolCalls.length, 2);
    assert.equal(new Set(toolCalls.map((c) => c.callId)).size, 2, "each call gets its own id");
    assert.deepEqual(handlerCalls.map((h) => h.callId), toolCalls.map((c) => c.callId));
    assert.deepEqual(results.map((r) => r.callId), toolCalls.map((c) => c.callId));
  });
});
