// =============================================================================
// Goal status transition — the single write path for goal-status side effects.
//
// Changing a goal's status has three companion effects: the student's goals
// cache must be invalidated, level progression must be ensured for plan-
// counting statuses, and completing a BHAG awards progression XP. The student
// PATCH route did all three while Sage's update_goal_status write tool did a
// bare prisma.goal.update — so agent-driven completions skipped XP,
// progression, and cache invalidation entirely (VQ-R-011). Both callers now
// route through this module.
// =============================================================================

import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { goalCountsTowardPlan, isGoalLevel } from "@/lib/goals";
import { recordBhagCompleted } from "@/lib/progression/engine";
import { updateProgression } from "@/lib/progression/service";

interface GoalAfterUpdate {
  id: string;
  level: string;
  status: string;
}

/**
 * Run the side effects that must accompany EVERY goal update, keyed off the
 * goal's post-update state. Callers invoke this immediately after their
 * prisma.goal.update.
 */
export async function applyGoalStatusEffects(
  studentId: string,
  updatedGoal: GoalAfterUpdate,
): Promise<void> {
  invalidatePrefix(`goals:${studentId}`);

  if (goalCountsTowardPlan(updatedGoal.status) && isGoalLevel(updatedGoal.level)) {
    await ensureGoalLevelProgression(studentId, [updatedGoal.level]);
  }

  // When a BHAG is marked completed, award XP and check tier unlocks.
  if (updatedGoal.level === "bhag" && updatedGoal.status === "completed") {
    await updateProgression(studentId, recordBhagCompleted);
  }
}

/**
 * Status-only transition used by Sage's update_goal_status tool: update the
 * status and run the same effects as the student route. The caller is
 * responsible for authorization and confirmation-card gating.
 */
export async function transitionGoalStatus(params: {
  studentId: string;
  goalId: string;
  status: string;
}): Promise<GoalAfterUpdate> {
  const { studentId, goalId, status } = params;

  const updatedGoal = await prisma.goal.update({
    where: { id: goalId },
    data: { status },
    select: { id: true, level: true, status: true },
  });

  await applyGoalStatusEffects(studentId, updatedGoal);
  return updatedGoal;
}
