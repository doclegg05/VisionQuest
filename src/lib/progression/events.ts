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
}: AwardEventParams): Promise<boolean> {
  try {
    await prisma.progressionEvent.create({
      data: {
        studentId,
        eventType,
        sourceType,
        sourceId,
        xp,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
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
    return false;
  }

  // Update the progression state snapshot
  if (mutate) {
    await updateProgression(studentId, mutate);
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
