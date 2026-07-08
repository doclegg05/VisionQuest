// =============================================================================
// Sage Agent — Headless Read-Only Turn
//
// Runs one agent turn with NO chat session and NO UI, for autonomous
// background work (daily briefing). Three independent layers keep a
// background run read-only regardless of the global SAGE_AGENT_MODE:
//
//   1. BRIEFING_TOOL_ALLOWLIST — a static, reviewed list of lookup tools.
//      UI-action tools (present_form, open_resource, search_forms) are
//      excluded on purpose: headless runs have no chat surface to render
//      action cards, and mutate tools are never listed.
//   2. resolveBriefingTools() intersects that list with the registry
//      filtered at the LITERAL "readonly" tier — never the global mode —
//      so a registry regression can't smuggle a mutate tool in.
//   3. guardProvider() intercepts every tool call BEFORE execution and
//      throws on any name outside the allowlist (covers a model
//      hallucinating an undeclared tool name).
// =============================================================================

import type { AIProvider, ChatMessage } from "@/lib/ai/types";
import type { Session } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { runAgentTurn } from "./loop";
import { getEnabledTools } from "./tools";

export const BRIEFING_TOOL_ALLOWLIST: ReadonlyArray<string> = [
  "lookup_cert_progress",
  "review_portfolio",
  "lookup_appointment",
  "lookup_program_info",
  "find_certification",
];

export class HeadlessToolViolation extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Headless run attempted non-allowlisted tool: ${toolName}`);
    this.name = "HeadlessToolViolation";
    this.toolName = toolName;
  }
}

/**
 * The tool names a headless briefing run may use: the static allowlist
 * intersected with the registry's student tools at the forced "readonly"
 * tier. Exported for tests — the invariant "never contains a mutate tool"
 * is asserted there.
 */
export function resolveBriefingTools(): string[] {
  const allowed = new Set(BRIEFING_TOOL_ALLOWLIST);
  return getEnabledTools("student", "readonly")
    .filter((tool) => allowed.has(tool.name))
    .map((tool) => tool.name);
}

/**
 * Wrap a provider so every tool call is allowlist-checked BEFORE the
 * executor runs it. Non-streamWithTools providers pass through unchanged
 * (the agent loop falls back to a plain stream — zero tool calls).
 */
export function guardProvider(
  inner: AIProvider,
  allowedTools: ReadonlySet<string>,
  onViolation: (toolName: string) => void,
): AIProvider {
  const streamWithTools = inner.streamWithTools?.bind(inner);
  return {
    name: inner.name,
    generateResponse: inner.generateResponse.bind(inner),
    streamResponse: inner.streamResponse.bind(inner),
    generateStructuredResponse: inner.generateStructuredResponse.bind(inner),
    ...(streamWithTools
      ? {
          streamWithTools: (
            systemPrompt: Parameters<NonNullable<AIProvider["streamWithTools"]>>[0],
            messages: Parameters<NonNullable<AIProvider["streamWithTools"]>>[1],
            tools: Parameters<NonNullable<AIProvider["streamWithTools"]>>[2],
            onToolCall: Parameters<NonNullable<AIProvider["streamWithTools"]>>[3],
            options?: Parameters<NonNullable<AIProvider["streamWithTools"]>>[4],
          ) =>
            streamWithTools(
              systemPrompt,
              messages,
              tools,
              async (call) => {
                if (!allowedTools.has(call.name)) {
                  onViolation(call.name);
                  throw new HeadlessToolViolation(call.name);
                }
                return onToolCall(call);
              },
              options,
            ),
        }
      : {}),
  };
}

export interface HeadlessTurnOptions {
  provider: AIProvider;
  systemPrompt: string;
  messages: ChatMessage[];
  studentId: string;
  /** Correlation id recorded on executor audit rows (e.g. "briefing:<panelId>"). */
  conversationId: string;
  maxHops?: number;
}

export interface HeadlessTurnResult {
  finalText: string;
  toolCallCount: number;
  stopReason: "complete" | "max_hops" | "error";
  /** Set when the model attempted a non-allowlisted tool; the turn aborted. */
  violation: string | null;
}

/**
 * Run one read-only agent turn as the student, headlessly. Never mutates:
 * the tool surface is the allowlist above, enforced pre-execution.
 */
export async function runHeadlessReadonlyTurn(
  options: HeadlessTurnOptions,
): Promise<HeadlessTurnResult> {
  const { provider, systemPrompt, messages, studentId, conversationId, maxHops } = options;

  const toolNames = resolveBriefingTools();
  const allowed = new Set(toolNames);
  let violation: string | null = null;

  const guarded = guardProvider(provider, allowed, (toolName) => {
    violation = toolName;
    logger.error("headless: blocked non-allowlisted tool call", {
      studentId,
      conversationId,
      toolName,
    });
  });

  // Synthetic student session: the run acts AS the student, so executor
  // role gates and studentId scoping apply exactly as in a chat turn.
  const session: Session = {
    id: studentId,
    studentId,
    displayName: "",
    role: "student",
  };

  let finalText = "";
  let toolCallCount = 0;
  let stopReason: HeadlessTurnResult["stopReason"] = "error";

  const turn = runAgentTurn({
    provider: guarded,
    systemPrompt,
    messages,
    session,
    conversationId,
    toolNames,
    maxHops: maxHops ?? 4,
  });

  for await (const event of turn) {
    switch (event.type) {
      case "tool_call":
        toolCallCount++;
        // Belt-and-braces: the guard already blocked execution pre-flight;
        // an off-list name surfacing here means the guard was bypassed.
        if (!allowed.has(event.tool) && !violation) {
          violation = event.tool;
          logger.error("headless: off-list tool_call event observed", {
            studentId,
            conversationId,
            toolName: event.tool,
          });
        }
        break;
      case "agent_stop":
        finalText = event.finalText;
        stopReason = event.reason;
        break;
      default:
        break; // text/tool_result/action events carry nothing headless needs
    }
  }

  return { finalText, toolCallCount, stopReason, violation };
}
