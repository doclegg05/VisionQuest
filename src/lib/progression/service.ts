import { prisma } from "@/lib/db";
import { invalidatePrefix } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { parseState, createInitialState, type ProgressionState } from "./engine";

const MAX_RETRIES = 3;

/**
 * Read the current progression state for a student.
 * Creates an initial record if none exists.
 */
export async function getProgression(studentId: string): Promise<{ state: ProgressionState; version: number }> {
  const existing = await prisma.progression.findUnique({ where: { studentId } });
  if (existing) {
    return { state: parseState(existing.state), version: existing.version };
  }

  const initial = createInitialState();
  const created = await prisma.progression.create({
    data: { studentId, state: JSON.stringify(initial), version: 0 },
  });
  return { state: initial, version: created.version };
}

/**
 * Apply a mutation to progression state with optimistic locking.
 *
 * The `mutate` callback receives the current state and can modify it in place.
 * The write only succeeds if the version hasn't changed since the read.
 * Retries up to 3 times on version conflicts.
 *
 * Usage:
 *   await updateProgression(studentId, (state) => {
 *     recordChatSession(state);
 *     recordGoalSet(state, "bhag");
 *   });
 */
export async function updateProgression(
  studentId: string,
  mutate: (state: ProgressionState) => void,
): Promise<ProgressionState> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { state, version } = await getProgression(studentId);

    // Apply the mutation
    mutate(state);

    // Attempt to write with version check
    const result = await prisma.progression.updateMany({
      where: { studentId, version },
      data: {
        state: JSON.stringify(state),
        version: version + 1,
      },
    });

    if (result.count > 0) {
      // Success — invalidate cache and return
      invalidatePrefix(`progression:${studentId}`);
      return state;
    }

    // Version conflict — retry with fresh state
    logger.warn("Progression version conflict, retrying", {
      studentId,
      attempt: attempt + 1,
      expectedVersion: version,
    });
  }

  // All retries exhausted — log and return last state without saving
  logger.error("Progression update failed after retries", { studentId });
  const { state } = await getProgression(studentId);
  return state;
}
