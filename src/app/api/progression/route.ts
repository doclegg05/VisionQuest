import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getXpProgress, getAchievementsWithDefs, recordDailyCheckin, checkReadinessAchievements } from "@/lib/progression/engine";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { getProgression } from "@/lib/progression/service";
import { awardEvent, getRecentEvents } from "@/lib/progression/events";
import { withErrorHandler, unauthorized } from "@/lib/api-error";
import { prisma } from "@/lib/db";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  // Daily check-in: award XP if the student hasn't checked in today
  const today = new Date().toISOString().slice(0, 10);
  await awardEvent({
    studentId: session.id,
    eventType: "daily_checkin",
    sourceType: "checkin",
    sourceId: today,
    xp: 15,
    mutate: (state) => recordDailyCheckin(state),
  });

  // Re-read after potential daily checkin write, then check readiness achievements
  const { state: freshState } = await getProgression(session.id);
  const bhagGoal = await prisma.goal.findFirst({
    where: { studentId: session.id, level: "bhag", status: "completed" },
    select: { id: true },
  });
  const readiness = computeReadinessScore({ ...freshState, bhagCompleted: !!bhagGoal });

  const prevAchievementCount = freshState.achievements.length;
  checkReadinessAchievements(freshState, readiness.score);
  if (freshState.achievements.length > prevAchievementCount) {
    await awardEvent({
      studentId: session.id,
      eventType: "readiness_check",
      sourceType: "readiness",
      sourceId: today,
      xp: 0,
      mutate: (state) => checkReadinessAchievements(state, readiness.score),
    });
  }

  // Final read for display
  const { state } = await getProgression(session.id);
  const resumeData = await prisma.resumeData.findUnique({
    where: { studentId: session.id },
    select: { id: true },
  });
  if (!state.resumeCreated && resumeData) {
    state.resumeCreated = true;
  }
  const xpProgress = getXpProgress(state);
  const finalReadiness = computeReadinessScore({ ...state, bhagCompleted: !!bhagGoal });
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
    readinessScore: finalReadiness.score,
    readinessBreakdown: finalReadiness.breakdown,
    recentEvents,
  });
});
