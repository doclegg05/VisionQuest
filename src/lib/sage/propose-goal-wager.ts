import { logger } from "@/lib/logger";
import { createWager, goalProposalWagerInput } from "@/lib/sage/wagers";
import type { ProposeGoalResult } from "@/lib/sage/propose-goal";

/**
 * Create the goal_proposal wager after proposeGoal(). Runs on BOTH
 * "created" and "duplicate" (createWager is idempotent, so the duplicate
 * path recovers a wager a prior attempt failed to write). Never throws
 * into the caller's hot path — a wager failure logs and is swallowed.
 */
export async function maybeCreateGoalProposalWager(
  result: ProposeGoalResult,
  ctx: {
    studentId: string;
    sourceMessageId?: string | null;
    confidence?: number;
    now: Date;
  },
): Promise<void> {
  if (result.status !== "created" && result.status !== "duplicate") return;
  try {
    await createWager(
      goalProposalWagerInput({
        studentId: ctx.studentId,
        goalId: result.goalId,
        sourceMessageId: ctx.sourceMessageId,
        confidence: ctx.confidence,
        now: ctx.now,
      }),
    );
  } catch (err) {
    logger.error("Failed to create goal_proposal wager", {
      goalId: result.goalId,
      error: String(err),
    });
  }
}
