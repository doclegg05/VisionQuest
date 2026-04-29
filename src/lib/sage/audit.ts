/**
 * Audit-log helper for Sage-authored actions.
 *
 * All Sage writes (propose-goal, record-insight, summarize, etc.) flow
 * through this helper so the audit trail is uniform: every Sage action
 * has actorRole = "sage", links back to the conversation/message that
 * produced it, and includes the action namespace in the metadata.
 *
 * The actor identity is the operating session (the student or staff
 * member whose request triggered Sage). actorRole is hardcoded to
 * "sage" so audit-log queries can distinguish AI-authored actions
 * from human ones — this is one of the few places we deliberately
 * diverge actorId/actorRole to express "human X invoked Sage which
 * did Y."
 */

import { logAuditEvent } from "@/lib/audit";

export interface SageAction {
  /** The student whose data was acted on. */
  studentId: string;
  /**
   * The session.id of the human who triggered Sage. Recorded as
   * actorId so audit queries can still answer "what did user X cause
   * to happen", but actorRole is forced to "sage".
   */
  invokedBy: string;
  /** "sage.<verb>" — e.g. "sage.goal.propose", "sage.insight.record". */
  action: string;
  /** "goal" | "sage_insight" | "conversation" | "alert" | etc. */
  targetType: string;
  targetId?: string | null;
  /** Short human-readable summary; appears in admin audit views. */
  summary?: string | null;
  /** Conversation/message that produced the action — closed-loop key. */
  conversationId?: string | null;
  sourceMessageId?: string | null;
  /** Free-form metadata. Kept JSON-serializable. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Write a Sage-authored audit-log entry.
 *
 * Always sets actorRole="sage" and prefixes the action with "sage."
 * if the caller forgot. The conversation/message linkage is rolled
 * into metadata so the existing AuditLog schema doesn't need new
 * columns.
 */
export async function logSageAction(input: SageAction): Promise<void> {
  const action = input.action.startsWith("sage.")
    ? input.action
    : `sage.${input.action}`;

  const baseMetadata = {
    studentId: input.studentId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.sourceMessageId
      ? { sourceMessageId: input.sourceMessageId }
      : {}),
  };

  await logAuditEvent({
    actorId: input.invokedBy,
    actorRole: "sage",
    action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    summary: input.summary ?? null,
    metadata: input.metadata
      ? { ...baseMetadata, ...input.metadata }
      : baseMetadata,
  });
}
