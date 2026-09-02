import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AIProvider, ToolCallHandler, ToolStreamEvent } from "@/lib/ai/types";
import type { AgentEvent } from "./types";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";
process.env.SAGE_AGENT_MODE = "full";

// Two real read-tier student tools. The executor is mocked, so neither
// touches the DB; the delay makes the first-called tool finish last.
const SLOW_TOOL = "lookup_program_info";
const FAST_TOOL = "review_portfolio";
const DELAY_MS: Record<string, number> = { [SLOW_TOOL]: 25, [FAST_TOOL]: 0 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const executeAgentToolMock = mock.fn(
  async (opts: { toolName: string; args: Record<string, unknown>; callId?: string }) => {
    await sleep(DELAY_MS[opts.toolName] ?? 0);
    return {
      callId: opts.callId ?? "unset",
      tool: opts.toolName,
      args: opts.args,
      result: {
        status: "success" as const,
        summary: `${opts.toolName} ok`,
        data: { tool: opts.toolName },
      },
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
    };
  },
);
const warnMock = mock.fn();

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: warnMock, error: mock.fn() },
    requestId: () => "req-test",
  },
});
mock.module("./executor", {
  namedExports: { executeAgentTool: executeAgentToolMock },
});

let runAgentTurn: typeof import("./loop").runAgentTurn;

before(async () => {
  ({ runAgentTurn } = await import("./loop"));
});

interface PlannedCall {
  callId: string;
  name: string;
}

/**
 * Fake provider shaped like the real ones: yields every tool_call for the
 * hop, runs all handlers in parallel, then yields tool_result events in
 * `resultOrder`. A callId in resultOrder that was never planned is a stray
 * result; a planned callId missing from resultOrder never gets a result.
 */
function fakeProvider(plan: PlannedCall[], resultOrder: string[]): AIProvider {
  return {
    name: "fake",
    generateResponse: async () => "",
    generateStructuredResponse: async () => "{}",
    streamResponse: async function* (): AsyncGenerator<string> {
      throw new Error("plain stream must not be used when streamWithTools exists");
    },
    streamWithTools: async function* (
      _system,
      _messages,
      _tools,
      onToolCall: ToolCallHandler,
    ): AsyncGenerator<ToolStreamEvent> {
      for (const c of plan) {
        yield { kind: "tool_call", callId: c.callId, name: c.name, args: {} };
      }
      const settled = await Promise.all(
        plan.map(async (c) => ({
          c,
          r: await onToolCall({ callId: c.callId, name: c.name, args: {} }),
        })),
      );
      const byId = new Map(settled.map((s) => [s.c.callId, s]));
      for (const callId of resultOrder) {
        const s = byId.get(callId);
        yield {
          kind: "tool_result",
          callId,
          name: s?.c.name ?? "unknown",
          status: s?.r.status ?? "success",
          summary: s?.r.summary ?? "stray",
          response: s?.r.response ?? null,
        };
      }
      yield { kind: "text", text: "final" };
      yield { kind: "done", reason: "complete" };
    },
  };
}

async function collect(provider: AIProvider): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgentTurn({
    provider,
    systemPrompt: "sys",
    messages: [{ role: "user", content: "hi" }],
    session: { id: "stu-1", role: "student" } as never,
    conversationId: "conv-1",
    toolNames: [SLOW_TOOL, FAST_TOOL],
  })) {
    events.push(event);
  }
  return events;
}

type ToolResultEvent = Extract<AgentEvent, { type: "tool_result" }>;
type StopEvent = Extract<AgentEvent, { type: "agent_stop" }>;

const toolResults = (events: AgentEvent[]) =>
  events.filter((e): e is ToolResultEvent => e.type === "tool_result");
const stopEvent = (events: AgentEvent[]) =>
  events.find((e): e is StopEvent => e.type === "agent_stop");
const dataTool = (event: ToolResultEvent | undefined) =>
  (event?.data as { tool?: string } | undefined)?.tool;

describe("runAgentTurn — tool results matched by callId", () => {
  beforeEach(() => {
    executeAgentToolMock.mock.resetCalls();
    warnMock.mock.resetCalls();
  });

  it("routes each parallel result to its own call when results arrive out of completion order", async () => {
    // The slow tool is called first but finishes last, and its result event
    // is yielded last. Matching by array position hands the fast call the
    // slow call's payload.
    const events = await collect(
      fakeProvider(
        [
          { callId: "a", name: SLOW_TOOL },
          { callId: "b", name: FAST_TOOL },
        ],
        ["b", "a"],
      ),
    );

    const results = toolResults(events);
    assert.deepEqual(results.map((r) => r.callId), ["b", "a"]);
    assert.deepEqual(results.map(dataTool), [FAST_TOOL, SLOW_TOOL]);

    // The executor was handed the provider's callId, so the transcript is
    // keyed by the same id the SSE events carry.
    const executedIds = executeAgentToolMock.mock.calls
      .map((c) => (c.arguments[0] as { callId?: string }).callId)
      .sort();
    assert.deepEqual(executedIds, ["a", "b"]);
    const stop = stopEvent(events);
    assert.ok(stop);
    assert.deepEqual(stop.transcript.map((r) => r.callId).sort(), ["a", "b"]);
  });

  it("drops and logs a result whose callId matches no call", async () => {
    const events = await collect(
      fakeProvider([{ callId: "a", name: FAST_TOOL }], ["ghost", "a"]),
    );

    const results = toolResults(events);
    assert.deepEqual(results.map((r) => r.callId), ["a"]);
    assert.equal(dataTool(results[0]), FAST_TOOL);
    assert.equal(warnMock.mock.callCount(), 1);
  });

  it("gives a call that never receives a result an explicit error result, not a neighbor's payload", async () => {
    const events = await collect(
      fakeProvider(
        [
          { callId: "a", name: FAST_TOOL },
          { callId: "b", name: SLOW_TOOL },
        ],
        ["a"],
      ),
    );

    const results = toolResults(events);
    const a = results.find((r) => r.callId === "a");
    assert.equal(dataTool(a), FAST_TOOL);

    const b = results.find((r) => r.callId === "b");
    assert.ok(b, "call b gets a tool_result of its own");
    assert.equal(b.status, "error");
    assert.equal(b.data, undefined);

    const stop = stopEvent(events);
    assert.ok(stop);
    assert.ok(events.indexOf(b) < events.indexOf(stop), "error result precedes agent_stop");
  });
});
