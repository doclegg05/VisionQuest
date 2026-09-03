// =============================================================================
// Sage Agent — Turn Loop
//
// Drives one chat turn from user message → final reply, dispatching tool
// calls through the executor and yielding AgentEvents the chat route
// translates into SSE frames.
// =============================================================================

import { logger } from "@/lib/logger";
import type { AIProvider, ChatMessage, ToolDeclaration } from "@/lib/ai/types";
import type { Session } from "@/lib/api-error";
import { executeAgentTool } from "./executor";
import { getEnabledTools } from "./tools";
import type { AgentEvent, AgentTool, AgentToolCallRecord } from "./types";

interface AgentTurnOptions {
  provider: AIProvider;
  systemPrompt: string;
  messages: ChatMessage[];
  session: Session;
  conversationId: string;
  targetStudentId?: string;
  /** Override the role-based default tool subset (e.g., constrain to a single tool). */
  toolNames?: string[];
  maxHops?: number;
}

export async function* runAgentTurn(
  options: AgentTurnOptions,
): AsyncGenerator<AgentEvent> {
  const { provider, systemPrompt, messages, session, conversationId, targetStudentId, toolNames, maxHops } = options;

  const role = session.role || "student";
  const enabledTools = filterTools(getEnabledTools(role), toolNames);

  // No tools available or provider can't function-call → fall back to plain stream.
  if (enabledTools.length === 0 || !provider.streamWithTools) {
    yield* runFallbackStream(provider, systemPrompt, messages);
    return;
  }

  const declarations: ToolDeclaration[] = enabledTools.map(toToolDeclaration);
  // Records are keyed by the provider's callId — the id its tool_call and
  // tool_result events carry — so each result reaches its own call. A hop
  // with several calls runs the handlers in parallel and they finish in any
  // order, so "the last record added" is not the call this result belongs to.
  const records = new Map<string, AgentToolCallRecord>();
  // callId → tool name for calls announced by a tool_call event that have not
  // yet received a tool_result.
  const pendingCalls = new Map<string, string>();
  const finalChunks: string[] = [];

  try {
    const stream = provider.streamWithTools(
      systemPrompt,
      messages,
      declarations,
      async ({ callId, name, args }) => {
        const record = await executeAgentTool({
          session,
          conversationId,
          toolName: name,
          args,
          targetStudentId,
          callId,
        });
        records.set(callId, record);
        return toHandlerResult(record);
      },
      { maxHops: maxHops ?? 8 },
    );

    for await (const event of stream) {
      switch (event.kind) {
        case "text":
          finalChunks.push(event.text);
          yield { type: "text", text: event.text };
          break;
        case "tool_call":
          pendingCalls.set(event.callId, event.name);
          yield { type: "tool_call", callId: event.callId, tool: event.name, args: event.args };
          break;
        case "tool_result": {
          const record = records.get(event.callId);
          if (!record) {
            logger.warn("agent.loop: tool result matched no call; dropped", {
              callId: event.callId,
              tool: event.name,
            });
            break;
          }
          pendingCalls.delete(event.callId);
          yield {
            type: "tool_result",
            callId: event.callId,
            status: event.status,
            summary: event.summary,
            data: record.result.data,
          };
          yield* actionEvents(record);
          break;
        }
        case "done":
          yield* settleUnresultedCalls(pendingCalls, records);
          yield {
            type: "agent_stop",
            reason: event.reason === "max_hops" ? "max_hops" : "complete",
            transcript: [...records.values()],
            finalText: finalChunks.join(""),
          };
          return;
      }
    }
  } catch (err) {
    logger.error("agent.loop: provider stream failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    yield* settleUnresultedCalls(pendingCalls, records);
    yield {
      type: "agent_stop",
      reason: "error",
      transcript: [...records.values()],
      finalText: finalChunks.join(""),
    };
  }
}

/** What the provider feeds back to the model for one executed call. */
function toHandlerResult(record: AgentToolCallRecord) {
  const responsePayload = record.result.modelHint
    ? {
        summary: record.result.summary,
        modelHint: record.result.modelHint,
        data: record.result.data ?? null,
      }
    : record.result.data ?? { summary: record.result.summary };
  return {
    response: responsePayload,
    summary: record.result.summary,
    status: record.result.status,
  };
}

/** UI action cards a tool result asks the chat surface to render. */
function* actionEvents(record: AgentToolCallRecord): Generator<AgentEvent> {
  if (record.result.action) {
    const a = record.result.action;
    yield { type: "action", action: a.action, target: a.target, label: a.label, meta: a.meta };
  }
  for (const a of record.result.actions ?? []) {
    yield { type: "action", action: a.action, target: a.target, label: a.label, meta: a.meta };
  }
}

/**
 * Every announced call that never received a tool_result gets an explicit
 * error result of its own, so the UI never leaves a pill pending and never
 * shows it a neighbor's payload. A call the executor never ran also gets an
 * error record so the persisted transcript accounts for it.
 */
function* settleUnresultedCalls(
  pendingCalls: Map<string, string>,
  records: Map<string, AgentToolCallRecord>,
): Generator<AgentEvent> {
  for (const [callId, tool] of pendingCalls) {
    const summary = `Tool ${tool} did not return a result.`;
    if (!records.has(callId)) {
      const at = new Date().toISOString();
      records.set(callId, {
        callId,
        tool,
        args: {},
        result: { status: "error", summary },
        startedAt: at,
        finishedAt: at,
      });
    }
    yield { type: "tool_result", callId, status: "error", summary };
  }
  pendingCalls.clear();
}

async function* runFallbackStream(
  provider: AIProvider,
  systemPrompt: string,
  messages: ChatMessage[],
): AsyncGenerator<AgentEvent> {
  const finalChunks: string[] = [];
  for await (const chunk of provider.streamResponse(systemPrompt, messages)) {
    finalChunks.push(chunk);
    yield { type: "text", text: chunk };
  }
  yield { type: "agent_stop", reason: "complete", transcript: [], finalText: finalChunks.join("") };
}

function filterTools(tools: AgentTool[], toolNames?: string[]): AgentTool[] {
  if (!toolNames || toolNames.length === 0) return tools;
  const wanted = new Set(toolNames);
  return tools.filter((tool) => wanted.has(tool.name));
}

function toToolDeclaration(tool: AgentTool): ToolDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
