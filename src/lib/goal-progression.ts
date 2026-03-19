import { recordGoalSet } from "@/lib/progression/engine";
import { getProgression, updateProgression } from "@/lib/progression/service";
import type { GoalLevel } from "@/lib/goals";

export async function ensureGoalLevelProgression(
  studentId: string,
  levels: GoalLevel[],
): Promise<number> {
  const uniqueLevels = [...new Set(levels)];
  if (uniqueLevels.length === 0) return 0;

  // Read current state to check which levels are already recorded
  const { state: currentState } = await getProgression(studentId);
  const levelsToAdd = uniqueLevels.filter((level) => !currentState.completedGoalLevels.includes(level));
  if (levelsToAdd.length === 0) return 0;

  await updateProgression(studentId, (state) => {
    for (const level of levelsToAdd) {
      recordGoalSet(state, level);
    }
  });

  return levelsToAdd.length;
}
