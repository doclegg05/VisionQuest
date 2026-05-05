// =============================================================================
// Sage Agent — Shared Types
// Defines the runtime contract between the model, the executor, and the
// chat-route SSE stream. Mirrors the protocol spec at
// docs/superpowers/specs/2026-05-05-sage-agent-protocol.md.
// =============================================================================

import type { Session } from "@/lib/api-error";

/**
 * A tool the model is allowed to call mid-turn. The `parameters` schema is
 * Gemini-compatible (JSON Schema subset) so it can be passed straight into
 * `functionDeclarations`. The `execute` function runs server-side under the
 * student/teacher's session.
 */
export interface AgentTool {
  /** Stable id used by the model and slash commands (e.g., "present_form"). */
  name: string;

  /** One-sentence description shown to the model. */
  description: string;

  /** Gemini-compatible JSON Schema for the call arguments. */
  parameters: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };

  /**
   * Optional slash-command surface. When set, the UI exposes this tool as
   * `/<command>` in the slash-command menu. Slash invocations bypass the
   * model and call `execute` directly with a parsed argument map.
   */
  slashCommand?: {
    command: string; // "/form"
    label: string; // "Open a form"
    description: string;
    argHint?: string;
    parseArgs?: (raw: string) => Record<string, unknown>;
  };

  /** Roles allowed to invoke this tool. */
  requiredRoles: ReadonlyArray<"student" | "teacher" | "admin" | "coordinator">;

  /** Sage will not call this tool unless the env feature flag enables it. */
  enabled: boolean;

  /** Server-side handler. Receives parsed args + session + a request scope. */
  execute(
    args: Record<string, unknown>,
    ctx: AgentToolContext,
  ): Promise<AgentToolResult>;
}

export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: ReadonlyArray<string>;
  items?: JsonSchemaProperty;
}

export interface AgentToolContext {
  session: Session;
  conversationId: string;
  /** Optional studentId override for staff acting on behalf of a student. */
  targetStudentId?: string;
}

export interface AgentToolResult {
  /** Outcome status surfaced in the SSE `tool_result` event. */
  status: "success" | "error";
  /** One-line human-readable summary safe to render in chat. */
  summary: string;
  /** Structured payload the UI may render (form preview, list of matches). */
  data?: unknown;
  /**
   * Optional UI action the chat surface should expose as a button card.
   * Triggers an `action` SSE event in addition to `tool_result`.
   */
  action?: AgentAction;
  /**
   * Optional follow-up text sent back to the model in place of (or
   * alongside) `summary`. Lets the tool give the model richer context
   * for its next reply without surfacing it to the user.
   */
  modelHint?: string;
}

export type AgentActionKind =
  | "navigate"
  | "open_form"
  | "open_resource"
  | "highlight";

export interface AgentAction {
  action: AgentActionKind;
  target: string;
  label: string;
  meta?: Record<string, unknown>;
}

/**
 * Single record of a model→tool→model cycle. Persisted alongside the
 * assistant message so audits can replay the turn.
 */
export interface AgentToolCallRecord {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  result: AgentToolResult;
  startedAt: string;
  finishedAt: string;
}

/**
 * Events produced by the agent loop. The chat route translates these
 * 1:1 into SSE frames.
 */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | {
      type: "tool_result";
      callId: string;
      status: "success" | "error";
      summary: string;
      data?: unknown;
    }
  | { type: "action"; action: AgentActionKind; target: string; label: string; meta?: Record<string, unknown> }
  | { type: "agent_stop"; reason: "complete" | "max_hops" | "error"; transcript: AgentToolCallRecord[]; finalText: string };
