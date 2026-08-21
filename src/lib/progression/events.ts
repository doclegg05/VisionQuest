import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { updateProgression } from "./service";
import type { ProgressionState } from "./engine";

interface AwardEventParams {
  studentId: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  xp: number;
  metadata?: Record<string, unknown>;
  /** Mutation to apply to the progression state snapshot (same as engine functions). */
  mutate?: (state: ProgressionState) => void;
  /**
   * When true, a non-P2002 create failure is rethrown instead of being
   * swallowed into a `false` return. Default false preserves the original
   * contract for every existing caller, where `false` means "no-op" without
   * distinguishing "already recorded" (P2002 — genuinely idempotent) from
   * "the write actually failed" (any other error). A caller that needs a
   * real failure to surface as an error (e.g. an API route that must 500,
   * not 200, when the ledger write breaks) opts in per-call. P2002 still
   * returns false either way — this only changes what happens to a REAL
   * failure, never the idempotent path.
   */
  rethrowOnFailure?: boolean;
}

/**
 * Award a progression event with idempotency.
 *
 * 1. Attempts to insert a ProgressionEvent row
 * 2. If duplicate (unique constraint), returns false (no-op)
 * 3. If new, updates the Progression state snapshot via updateProgression()
 * 4. Returns true if newly awarded
 *
 * Usage:
 *   const awarded = await awardEvent({
 *     studentId: session.id,
 *     eventType: "chat_session",
 *     sourceType: "conversation",
 *     sourceId: conversationId,
 *     xp: 10,
 *     mutate: (state) => recordChatSession(state),
 *   });
 */
export async function awardEvent({
  studentId,
  eventType,
  sourceType,
  sourceId,
  xp,
  metadata,
  mutate,
  rethrowOnFailure = false,
}: AwardEventParams): Promise<boolean> {
  let createdEventId: string;
  try {
    const created = await prisma.progressionEvent.create({
      data: {
        studentId,
        eventType,
        sourceType,
        sourceId,
        xp,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
    createdEventId = created.id;
  } catch (err) {
    // Unique constraint violation = already awarded (idempotent)
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return false;
    }
    logger.error("Failed to create progression event", {
      eventType,
      sourceType,
      sourceId,
      error: String(err),
    });
    if (rethrowOnFailure) throw err;
    return false;
  }

  // Update the progression state snapshot. The event row is the idempotency
  // key, so it is created first — but that means a failure here would otherwise
  // be unrecoverable: a retry hits the unique constraint (P2002 → returns
  // false) and skips the mutation forever, leaving the event recorded with no
  // XP/state change. Roll the event row back on failure so a retry re-applies
  // both. (A single $transaction would be cleaner, but updateProgression uses
  // optimistic version-locking with internal retries that don't compose with
  // an interactive transaction.)
  if (mutate) {
    try {
      await updateProgression(studentId, mutate);
    } catch (err) {
      await prisma.progressionEvent
        .delete({ where: { id: createdEventId } })
        .catch((rollbackErr) =>
          logger.error("Failed to roll back progression event after update failure", {
            eventType,
            sourceType,
            sourceId,
            error: String(rollbackErr),
          }),
        );
      throw err;
    }
  }

  return true;
}

/**
 * Get recent progression events for a student.
 */
export async function getRecentEvents(studentId: string, limit = 20) {
  return prisma.progressionEvent.findMany({
    where: { studentId },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      eventType: true,
      sourceType: true,
      xp: true,
      occurredAt: true,
    },
  });
}
