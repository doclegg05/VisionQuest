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
  const transcript: AgentToolCallRecord[] = [];
  const finalChunks: string[] = [];

  try {
    const stream = provider.streamWithTools(
      systemPrompt,
      messages,
      declarations,
      async ({ name, args }) => {
        const record = await executeAgentTool({
          session,
          conversationId,
          toolName: name,
          args,
          targetStudentId,
        });
        transcript.push(record);
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
          yield { type: "tool_call", callId: event.callId, tool: event.name, args: event.args };
          break;
        case "tool_result": {
          // Find the matching transcript record (added by the onToolCall handler above).
          const record = transcript[transcript.length - 1];
          yield {
            type: "tool_result",
            callId: event.callId,
            status: event.status,
            summary: event.summary,
            data: record?.result.data,
          };
          if (record?.result.action) {
            const a = record.result.action;
            yield { type: "action", action: a.action, target: a.target, label: a.label, meta: a.meta };
          }
          if (record?.result.actions) {
            for (const a of record.result.actions) {
              yield { type: "action", action: a.action, target: a.target, label: a.label, meta: a.meta };
            }
          }
          break;
        }
        case "done":
          yield {
            type: "agent_stop",
            reason: event.reason === "max_hops" ? "max_hops" : "complete",
            transcript,
            finalText: finalChunks.join(""),
          };
          return;
      }
    }
  } catch (err) {
    logger.error("agent.loop: provider stream failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    yield {
      type: "agent_stop",
      reason: "error",
      transcript,
      finalText: finalChunks.join(""),
    };
  }
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
