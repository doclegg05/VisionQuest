import { recordGoalSet } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import type { GoalLevel } from "@/lib/goals";

export async function ensureGoalLevelProgression(
  studentId: string,
  levels: GoalLevel[],
): Promise<number> {
  const uniqueLevels = [...new Set(levels)];
  if (uniqueLevels.length === 0) return 0;

  let awarded = 0;
  for (const level of uniqueLevels) {
    const ok = await awardEvent({
      studentId,
      eventType: `${level}_set`,
      sourceType: "goal",
      sourceId: `${studentId}:${level}`,
      xp: 50,
      mutate: (state) => recordGoalSet(state, level),
    });
    if (ok) awarded++;
  }

  return awarded;
}
