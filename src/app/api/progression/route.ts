import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseState, createInitialState, getXpProgress, getAchievementsWithDefs, recordDailyCheckin, checkReadinessAchievements } from "@/lib/progression/engine";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { cached, invalidate } from "@/lib/cache";
import { withErrorHandler, unauthorized } from "@/lib/api-error";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const progression = await cached(`progression:${session.id}`, 60, () =>
    prisma.progression.findUnique({ where: { studentId: session.id } }),
  );

  const state = progression ? parseState(progression.state) : createInitialState();
  let mutated = false;

  // Daily check-in: award XP if the student hasn't checked in today
  const today = new Date().toISOString().slice(0, 10);
  const lastCheckin = state.streakDays.length > 0 ? state.streakDays[state.streakDays.length - 1] : null;
  if (lastCheckin !== today) {
    recordDailyCheckin(state);
    await prisma.progression.upsert({
      where: { studentId: session.id },
      update: { state: JSON.stringify(state) },
      create: { studentId: session.id, state: JSON.stringify(state) },
    });
    mutated = true;
  }

  const xpProgress = getXpProgress(state);
  const readiness = computeReadinessScore(state);

  // Check for readiness achievements and persist if new ones unlocked
  const prevAchievementCount = state.achievements.length;
  checkReadinessAchievements(state, readiness.score);
  if (state.achievements.length > prevAchievementCount) {
    await prisma.progression.upsert({
      where: { studentId: session.id },
      update: { state: JSON.stringify(state) },
      create: { studentId: session.id, state: JSON.stringify(state) },
    });
    mutated = true;
  }

  if (mutated) {
    invalidate(`progression:${session.id}`);
  }

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
    readinessScore: readiness.score,
    readinessBreakdown: readiness.breakdown,
  });
});
