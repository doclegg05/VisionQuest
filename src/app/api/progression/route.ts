import { NextResponse } from "next/server";
import { getXpProgress, getAchievementsWithDefs, checkReadinessAchievements } from "@/lib/progression/engine";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { awardEvent, getRecentEvents } from "@/lib/progression/events";
import { withAuth } from "@/lib/api-error";

/**
 * GET /api/progression — read the student's progression state.
 *
 * VQ-R-006: this handler used to award the daily_checkin event (+15 XP and a
 * streak day) unconditionally. ProgressionProvider is mounted in the student
 * layout, so it fired on every page mount and after every goal action: a
 * seven-day "attendance streak" recorded seven page loads, and that tier is
 * presented as a downloadable Certificate of Attendance in a program where
 * attendance carries funding consequences. The award now belongs to
 * POST /api/mood, a deliberate once-a-day student act.
 *
 * What remains is a zero-XP reconciliation of readiness achievements. It is
 * kept here deliberately: readiness moves in response to many actions (certs,
 * portfolio, goals) and this is the only place that reconciles it, so removing
 * it would mean readiness achievements were never granted at all. It awards no
 * XP, never advances a streak, and is idempotent per day.
 */
export const GET = withAuth(async (session) => {
  const today = new Date().toISOString().slice(0, 10);

  // One read per request. The handler no longer writes before reading, so the
  // previous read-write-read sequence (two full readiness fetches per call, on
  // a route the provider hits on every mount) is gone.
  const { state, readiness } = await fetchStudentReadinessData(session.id);

  const prevAchievementCount = state.achievements.length;
  checkReadinessAchievements(state, readiness.score);
  if (state.achievements.length > prevAchievementCount) {
    // Persist the newly-earned achievements. xp: 0 — reaching a readiness
    // threshold is recognition of work already rewarded elsewhere, not a
    // second payout. `state` above is already mutated in place by the call
    // that detected them, so it is safe to render from directly.
    await awardEvent({
      studentId: session.id,
      eventType: "readiness_check",
      sourceType: "readiness",
      sourceId: today,
      xp: 0,
      mutate: (draft) => checkReadinessAchievements(draft, readiness.score),
    });
  }

  const xpProgress = getXpProgress(state);
  const achievements = getAchievementsWithDefs(state);

  // Recent activity: last 5 achievements with timestamps (from achievements
  // array order) and last level-up from levelUpHistory
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
