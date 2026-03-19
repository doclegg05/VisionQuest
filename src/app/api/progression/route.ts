import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getXpProgress, getAchievementsWithDefs, recordDailyCheckin, checkReadinessAchievements } from "@/lib/progression/engine";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { getProgression, updateProgression } from "@/lib/progression/service";
import { withErrorHandler, unauthorized } from "@/lib/api-error";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  // Daily check-in: award XP if the student hasn't checked in today
  const { state: currentState } = await getProgression(session.id);
  const today = new Date().toISOString().slice(0, 10);
  const lastCheckin = currentState.streakDays.length > 0 ? currentState.streakDays[currentState.streakDays.length - 1] : null;
  if (lastCheckin !== today) {
    await updateProgression(session.id, (state) => {
      recordDailyCheckin(state);
    });
  }

  // Re-read after potential daily checkin write, then check readiness achievements
  const { state: freshState } = await getProgression(session.id);
  const readiness = computeReadinessScore(freshState);

  const prevAchievementCount = freshState.achievements.length;
  checkReadinessAchievements(freshState, readiness.score);
  if (freshState.achievements.length > prevAchievementCount) {
    await updateProgression(session.id, (state) => {
      checkReadinessAchievements(state, readiness.score);
    });
  }

  // Final read for display
  const { state } = await getProgression(session.id);
  const xpProgress = getXpProgress(state);
  const finalReadiness = computeReadinessScore(state);
  const achievements = getAchievementsWithDefs(state);

  // Recent activity: last 5 achievements with timestamps (from achievements array order)
  // and last level-up from levelUpHistory
  const recentAchievements = achievements.slice(-5).reverse();
  const lastLevelUp = state.levelUpHistory?.length > 0
    ? state.levelUpHistory[state.levelUpHistory.length - 1]
    : null;

  return NextResponse.json({
    ...state,
    xpProgress,
    achievementsWithDefs: achievements,
    recentAchievements,
    lastLevelUp,
    readinessScore: finalReadiness.score,
    readinessBreakdown: finalReadiness.breakdown,
  });
});
