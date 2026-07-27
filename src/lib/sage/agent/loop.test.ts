// =============================================================================
// VQ-R-010 — Parallel tool calls must not cross-wire results.
//
// The provider runs multiple tool handlers in parallel (Promise.all in
// streamWithTools), so transcript push order follows handler COMPLETION order,
// not call order. The loop must attribute each tool_result event to the
// transcript record with the matching callId — never "the last record pushed".
// This test makes the second call resolve first to force the orders apart.
// =============================================================================
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { AIProvider, ChatMessage, ToolCallHandler, ToolDeclaration, ToolStreamEvent } from "@/lib/ai/types";
import type { Session } from "@/lib/api-error";
import type { AgentEvent, AgentToolCallRecord } from "./types";

const executedCalls: Array<{ toolName: string; callId?: string }> = [];

mock.module("./executor", {
  namedExports: {
    executeAgentTool: async (options: {
      toolName: string;
      args: Record<string, unknown>;
      callId?: string;
    }): Promise<AgentToolCallRecord> => {
      executedCalls.push({ toolName: options.toolName, callId: options.callId });
      // Mirror the real executor: honor the provider-supplied callId when given.
      return {
        callId: options.callId ?? `generated-${options.toolName}`,
        tool: options.toolName,
        args: options.args,
        result: {
          status: "success",
          summary: `${options.toolName} ok`,
          data: { from: options.toolName },
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
    },
  },
});

mock.module("./tools", {
  namedExports: {
    getEnabledTools: () => [
      {
        name: "tool_a",
        description: "first test tool",
        parameters: { type: "object", properties: {} },
        riskTier: "read",
        requiredRoles: [],
        enabled: true,
        execute: async () => ({ status: "success", summary: "unused" }),
      },
      {
        name: "tool_b",
        description: "second test tool",
        parameters: { type: "object", properties: {} },
        riskTier: "read",
        requiredRoles: [],
        enabled: true,
        execute: async () => ({ status: "success", summary: "unused" }),
      },
    ],
  },
});

let runAgentTurn: typeof import("./loop").runAgentTurn;

before(async () => {
  ({ runAgentTurn } = await import("./loop"));
});

const session: Session = {
  id: "student-1",
  studentId: "student-1",
  displayName: "Student One",
  role: "student",
};

/**
 * Fake provider mimicking GeminiProvider.streamWithTools' parallel hop:
 * yield both tool_call events, run both handlers under Promise.all with the
 * SECOND call resolving first, then yield tool_result events in call order.
 */
function makeParallelProvider(): AIProvider {
  async function* streamWithTools(
    _systemPrompt: string,
    _messages: ChatMessage[],
    _tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
  ): AsyncGenerator<ToolStreamEvent> {
    const calls = [
      { callId: "call-a", name: "tool_a", args: { which: "a" } },
      { callId: "call-b", name: "tool_b", args: { which: "b" } },
    ];
    for (const c of calls) {
      yield { kind: "tool_call", callId: c.callId, name: c.name, args: c.args };
    }
    const [resultA, resultB] = await Promise.all([
      // tool_a is slow: it completes AFTER tool_b, so the transcript's last
      // entry while processing tool_a's result is tool_a, but for tool_b's
      // result it is ALSO tool_a under the buggy last-record lookup.
      new Promise<Awaited<ReturnType<ToolCallHandler>>>((resolve) => {
        setTimeout(() => {
          void onToolCall(calls[0]).then(resolve);
        }, 20);
      }),
      onToolCall(calls[1]),
    ]);
    yield {
      kind: "tool_result",
      callId: "call-a",
      name: "tool_a",
      status: resultA.status,
      summary: resultA.summary,
      response: resultA.response,
    };
    yield {
      kind: "tool_result",
      callId: "call-b",
      name: "tool_b",
      status: resultB.status,
      summary: resultB.summary,
      response: resultB.response,
    };
    yield { kind: "done", reason: "complete" };
  }

  return {
    name: "ollama",
    streamResponse: async function* () {
      yield "";
    },
    generateResponse: async () => "",
    streamWithTools,
  } as unknown as AIProvider;
}

describe("agent loop parallel tool-call attribution (VQ-R-010)", () => {
  it("attributes each tool_result event to the record with the matching callId", async () => {
    executedCalls.length = 0;
    const events: AgentEvent[] = [];
    for await (const event of runAgentTurn({
      provider: makeParallelProvider(),
      systemPrompt: "test",
      messages: [{ role: "user", content: "run both tools" }],
      session,
      conversationId: "conv-1",
    })) {
      events.push(event);
    }

    const results = events.filter(
      (e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result",
    );
    assert.equal(results.length, 2);

    const forA = results.find((r) => r.callId === "call-a");
    const forB = results.find((r) => r.callId === "call-b");
    assert.ok(forA, "missing tool_result for call-a");
    assert.ok(forB, "missing tool_result for call-b");

    // The heart of VQ-R-010: each event's data must come from ITS OWN tool.
    assert.deepEqual(forA.data, { from: "tool_a" });
    assert.deepEqual(forB.data, { from: "tool_b" });

    const stop = events.find(
      (e): e is Extract<AgentEvent, { type: "agent_stop" }> => e.type === "agent_stop",
    );
    assert.ok(stop, "missing agent_stop event");
    assert.equal(stop.transcript.length, 2);
  });

  it("threads the provider callId through to the executor", async () => {
    executedCalls.length = 0;
    for await (const event of runAgentTurn({
      provider: makeParallelProvider(),
      systemPrompt: "test",
      messages: [{ role: "user", content: "run both tools" }],
      session,
      conversationId: "conv-1",
    })) {
      void event;
    }
    const byTool = new Map(executedCalls.map((c) => [c.toolName, c.callId]));
    assert.equal(byTool.get("tool_a"), "call-a");
    assert.equal(byTool.get("tool_b"), "call-b");
  });
});
