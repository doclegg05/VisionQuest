import { NextResponse } from "next/server";
import { getXpProgress, getAchievementsWithDefs } from "@/lib/progression/engine";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { getRecentEvents } from "@/lib/progression/events";
import { withAuth } from "@/lib/api-error";

/**
 * Read-only progression snapshot. The daily check-in that used to be awarded
 * here lives at POST /api/progression/checkin (2026-09-01 review F25 /
 * VQ-R-006): a GET must not mint XP or record achievements.
 */
export const GET = withAuth(async (session) => {
  const { state, readiness } = await fetchStudentReadinessData(session.id);
  const xpProgress = getXpProgress(state);
  const achievements = getAchievementsWithDefs(state);

  // Recent activity: last 5 achievements with timestamps (from achievements array order)
  // and last level-up from levelUpHistory
  const recentAchievements = achievements.slice(-5).reverse();
  const lastLevelUp = state.levelUpHistory?.length > 0
    ? state.levelUpHistory[state.levelUpHistory.length - 1]
    : null;

  const recentEvents = await getRecentEvents(session.id, 20);

  return NextResponse.json({
    ...state,
    xpProgress,
    achievementsWithDefs: achievements,
    recentAchievements,
    lastLevelUp,
    readinessScore: readiness.score,
    readinessBreakdown: readiness.breakdown,
    recentEvents,
  });
});
