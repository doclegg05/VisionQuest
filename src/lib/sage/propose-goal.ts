/**
 * Sage's "propose a goal" action — Tier A step 4 of the closed-loop
 * architecture (docs/plans/2026-04-29-sage-closed-loop.md).
 *
 * Sage drafts goals with status="proposed". Students confirm or
 * dismiss them via the Goals page; staff can also confirm on the
 * student's behalf. Confirmation flips status to "active" and stamps
 * confirmedAt/confirmedBy. The traceability fields (sourceMessageId)
 * close the loop: any "active" goal can answer "did Sage propose
 * this, and how long did it take to confirm?"
 *
 * Idempotency: deduped on (studentId, sourceMessageId, level). The
 * same Sage turn never produces two proposals at the same level.
 *
 * This module is callable two ways:
 *   - From the HTTP route (sage.propose_goal tool, student-initiated)
 *   - Directly from goal-extractor in the chat post-response loop
 *     (step 7 of the plan)
 */

import { prisma } from "@/lib/db";
import { logSageAction } from "@/lib/sage/audit";
import { invalidatePrefix } from "@/lib/cache";

export const PROPOSAL_STATUS = "proposed" as const;

const VALID_LEVELS = new Set([
  "bhag",
  "monthly",
  "weekly",
  "daily",
  "task",
]);

export interface ProposeGoalInput {
  studentId: string;
  level: string;
  content: string;
  /** ID of the Sage message that produced this proposal. Required for
   *  closed-loop traceability and for idempotency dedupe. */
  sourceMessageId: string;
  conversationId?: string;
  parentId?: string | null;
  /** Session.id of the human invoking Sage (the student or a teacher
   *  acting on their behalf). Used as actorId in the audit log. */
  invokedBy: string;
  /** Sage's self-scored confidence 0–1, optional. */
  confidence?: number;
}

export type ProposeGoalResult =
  | { status: "created"; goalId: string }
  | { status: "duplicate"; goalId: string }
  | { status: "rejected"; reason: string };

/**
 * Pure validation. Exposed for testing.
 *
 * Returns the trimmed content on success, or a rejection reason. Kept
 * separate from proposeGoal() so the validation logic can be exercised
 * without a Prisma client.
 */
export function validateProposalInput(
  input: Pick<ProposeGoalInput, "level" | "content" | "sourceMessageId">,
): { ok: true; content: string } | { ok: false; reason: string } {
  const content = input.content.trim();
  if (!content) return { ok: false, reason: "content is empty" };
  if (content.length > 1000) return { ok: false, reason: "content exceeds 1000 chars" };
  if (!VALID_LEVELS.has(input.level))
    return { ok: false, reason: `invalid level: ${input.level}` };
  if (!input.sourceMessageId)
    return { ok: false, reason: "sourceMessageId is required" };
  return { ok: true, content };
}

/**
 * Validate input and idempotently insert a proposed Goal row.
 *
 * Returns "duplicate" (not an error) when an identical proposal
 * already exists for the same (studentId, sourceMessageId, level)
 * — this happens when the post-response loop retries after a
 * transient failure.
 */
export async function proposeGoal(
  input: ProposeGoalInput,
): Promise<ProposeGoalResult> {
  const validation = validateProposalInput(input);
  if (!validation.ok) {
    return { status: "rejected", reason: validation.reason };
  }
  const content = validation.content;

  // Idempotency: same Sage turn cannot propose two goals at the same level.
  const existing = await prisma.goal.findFirst({
    where: {
      studentId: input.studentId,
      sourceMessageId: input.sourceMessageId,
      level: input.level,
    },
    select: { id: true, status: true },
  });
  if (existing) {
    return { status: "duplicate", goalId: existing.id };
  }

  const goal = await prisma.goal.create({
    data: {
      studentId: input.studentId,
      level: input.level,
      content,
      status: PROPOSAL_STATUS,
      sourceMessageId: input.sourceMessageId,
      parentId: input.parentId ?? null,
    },
    select: { id: true, level: true, content: true },
  });

  await logSageAction({
    studentId: input.studentId,
    invokedBy: input.invokedBy,
    action: "sage.goal.propose",
    targetType: "goal",
    targetId: goal.id,
    summary: `Sage proposed a ${goal.level} goal: "${goal.content.slice(0, 80)}${goal.content.length > 80 ? "…" : ""}"`,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.sourceMessageId,
    metadata: {
      level: goal.level,
      ...(typeof input.confidence === "number"
        ? { confidence: input.confidence }
        : {}),
    },
  });

  // Bust the goals cache so the next read picks up the proposal.
  invalidatePrefix(`goals:${input.studentId}`);

  return { status: "created", goalId: goal.id };
}
