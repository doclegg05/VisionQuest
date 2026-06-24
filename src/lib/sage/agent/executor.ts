// =============================================================================
// Sage Agent — Tool Executor
//
// Single entry point for running an agent tool call. Handles permission
// checking, argument coercion, audit logging, and result normalization.
// =============================================================================

import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import { logAuditEvent } from "@/lib/audit";
import type { Session } from "@/lib/api-error";
import { getToolByName, findToolBySlashCommand } from "./tools";
import { validateToolArgs } from "./validation";
import type { AgentTool, AgentToolCallRecord, AgentToolResult } from "./types";

export interface ExecuteToolOptions {
  session: Session;
  conversationId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** When the staff is acting on a specific student. */
  targetStudentId?: string;
  /** Provided when the call originated from the model rather than a slash command. */
  callId?: string;
  /** Set ONLY by /api/chat/tool-confirm — see AgentToolContext.confirmedToken. */
  confirmedToken?: string;
}

export async function executeAgentTool(
  options: ExecuteToolOptions,
): Promise<AgentToolCallRecord> {
  const { session, conversationId, toolName, args, targetStudentId, confirmedToken } = options;
  const callId = options.callId ?? randomUUID();
  const startedAt = new Date().toISOString();

  const tool = getToolByName(toolName);
  if (!tool) {
    return errorRecord(callId, toolName, args, startedAt, `Unknown tool: ${toolName}.`);
  }
  if (!tool.enabled) {
    return errorRecord(callId, toolName, args, startedAt, `Tool ${toolName} is disabled.`);
  }
  if (!isAuthorized(session, tool)) {
    return errorRecord(
      callId,
      toolName,
      args,
      startedAt,
      `You don't have permission to use ${toolName}.`,
    );
  }

  const validation = validateToolArgs(tool, args);
  if (!validation.ok) {
    return errorRecord(
      callId,
      toolName,
      args,
      startedAt,
      `Tool call rejected before execution: ${validation.error}`,
      {
        modelHint:
          `Your ${toolName} tool call did not match the declared schema. ` +
          `${validation.error} Call the tool again with only valid JSON arguments.`,
      },
    );
  }

  try {
    const result = await tool.execute(validation.args, {
      session,
      conversationId,
      confirmedToken,
      targetStudentId,
    });

    const finishedAt = new Date().toISOString();

    // Best-effort audit. Failures here must not break the agent loop.
    void logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: `sage.tool.${toolName}`,
      targetType: "sage_conversation",
      targetId: conversationId,
      summary: `Sage tool "${toolName}" → ${result.status}: ${result.summary}`,
      metadata: {
        callId,
        args: validation.args,
        status: result.status,
        targetStudentId: targetStudentId ?? null,
        actionKind: result.action?.action ?? null,
      },
    }).catch((err) => {
      logger.warn("agent.executor: audit log failed", { err: String(err), toolName });
    });

    return { callId, tool: toolName, args: validation.args, result, startedAt, finishedAt };
  } catch (err) {
    logger.error("agent.executor: tool threw", {
      toolName,
      err: err instanceof Error ? err.message : String(err),
    });
    return errorRecord(
      callId,
      toolName,
      args,
      startedAt,
      err instanceof Error ? err.message : "Tool failed unexpectedly.",
    );
  }
}

/**
 * Slash-command path: `/form spokes-profile` → resolve tool, parse args, run.
 */
export async function executeSlashCommand(
  rawMessage: string,
  session: Session,
  conversationId: string,
  targetStudentId?: string,
): Promise<{ tool: AgentTool; record: AgentToolCallRecord } | null> {
  const trimmed = rawMessage.trim();
  if (!trimmed.startsWith("/")) return null;

  const [head, ...rest] = trimmed.split(/\s+/);
  const tool = findToolBySlashCommand(head);
  if (!tool) return null;

  const argsRaw = rest.join(" ").trim();
  const parsed = tool.slashCommand?.parseArgs?.(argsRaw) ?? {};

  const record = await executeAgentTool({
    session,
    conversationId,
    toolName: tool.name,
    args: parsed,
    targetStudentId,
  });

  return { tool, record };
}

function isAuthorized(session: Session, tool: AgentTool): boolean {
  if (tool.requiredRoles.length === 0) return true;
  return tool.requiredRoles.some(
    (role) =>
      role === session.role ||
      (session.role === "admin" && role !== "student"),
  );
}

function errorRecord(
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  startedAt: string,
  message: string,
  options: { modelHint?: string } = {},
): AgentToolCallRecord {
  const result: AgentToolResult = {
    status: "error",
    summary: message,
    ...(options.modelHint ? { modelHint: options.modelHint } : {}),
  };
  return {
    callId,
    tool: toolName,
    args,
    result,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
