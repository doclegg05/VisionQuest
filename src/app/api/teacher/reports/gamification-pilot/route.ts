import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { ACHIEVEMENT_DEFS, parseState } from "@/lib/progression/engine";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

/**
 * GET /api/teacher/reports/gamification-pilot
 *
 * Measures whether gamification elements correlate with real behavioral lift.
 * Reports adoption rates, achievement distribution, and streak-to-readiness correlation.
 *
 * This data helps decide whether to keep, expand, or kill gamification.
 */
export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId") ?? undefined;
  if (classId) await assertStaffCanManageClass(session, classId);

  const studentIds = await listManagedStudentIds(session, {
    classId,
    includeInactiveAccounts: false,
  });

  if (studentIds.length === 0) {
    return NextResponse.json({ students: 0, pilot: null });
  }

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      progression: { select: { state: true } },
      goals: {
        select: { id: true, status: true, level: true },
      },
    },
  });

  // Parse progression states
  const parsed = students.map((s) => {
    const state = s.progression?.state ? parseState(s.progression.state) : null;
    return { id: s.id, state, goals: s.goals };
  });

  // Adoption metrics
  const withAnyAchievement = parsed.filter(
    (s) => s.state && s.state.achievements.length > 0,
  ).length;
  const withStreak3Plus = parsed.filter(
    (s) => s.state && s.state.longestStreak >= 3,
  ).length;
  const withStreak7Plus = parsed.filter(
    (s) => s.state && s.state.longestStreak >= 7,
  ).length;
  const withStreak14Plus = parsed.filter(
    (s) => s.state && s.state.longestStreak >= 14,
  ).length;

  // Achievement distribution
  const achievementCounts: Record<string, number> = {};
  for (const s of parsed) {
    if (!s.state) continue;
    for (const achId of s.state.achievements) {
      achievementCounts[achId] = (achievementCounts[achId] || 0) + 1;
    }
  }

  const topAchievements = Object.entries(achievementCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      id,
      label: ACHIEVEMENT_DEFS[id]?.label ?? id,
      count,
      rate: Math.round((count / studentIds.length) * 100),
    }));

  // Behavioral correlation: compare readiness scores of students with
  // streaks >= 7 vs those without
  const readinessResults = await Promise.all(
    parsed.map(async (s) => {
      const data = await fetchStudentReadinessData(s.id);
      return {
        id: s.id,
        readiness: data.readiness.score,
        longestStreak: s.state?.longestStreak ?? 0,
        xp: s.state?.xp ?? 0,
        achievementCount: s.state?.achievements.length ?? 0,
        completedGoals: s.goals.filter((g) => g.status === "completed").length,
      };
    }),
  );

  const withStreak = readinessResults.filter((s) => s.longestStreak >= 7);
  const withoutStreak = readinessResults.filter((s) => s.longestStreak < 7);

  const avgReadinessWithStreak = withStreak.length > 0
    ? Math.round(withStreak.reduce((sum, s) => sum + s.readiness, 0) / withStreak.length)
    : 0;
  const avgReadinessWithoutStreak = withoutStreak.length > 0
    ? Math.round(withoutStreak.reduce((sum, s) => sum + s.readiness, 0) / withoutStreak.length)
    : 0;

  const avgGoalsWithStreak = withStreak.length > 0
    ? Math.round((withStreak.reduce((sum, s) => sum + s.completedGoals, 0) / withStreak.length) * 10) / 10
    : 0;
  const avgGoalsWithoutStreak = withoutStreak.length > 0
    ? Math.round((withoutStreak.reduce((sum, s) => sum + s.completedGoals, 0) / withoutStreak.length) * 10) / 10
    : 0;

  const readinessLift = avgReadinessWithStreak - avgReadinessWithoutStreak;
  const goalLift = avgGoalsWithStreak - avgGoalsWithoutStreak;

  // Pilot verdict
  // Per product guide: "any gamification shipped in this period must improve
  // at least one real behavior by 10% in a pilot"
  const meetsLiftThreshold = readinessLift >= 10 || goalLift >= 0.5;

  return NextResponse.json({
    students: studentIds.length,
    pilot: {
      adoption: {
        withAnyAchievement,
        achievementRate: Math.round((withAnyAchievement / studentIds.length) * 100),
        withStreak3Plus,
        withStreak7Plus,
        withStreak14Plus,
      },
      topAchievements,
      behavioralCorrelation: {
        streakThreshold: 7,
        groupWithStreak: {
          count: withStreak.length,
          avgReadiness: avgReadinessWithStreak,
          avgCompletedGoals: avgGoalsWithStreak,
        },
        groupWithoutStreak: {
          count: withoutStreak.length,
          avgReadiness: avgReadinessWithoutStreak,
          avgCompletedGoals: avgGoalsWithoutStreak,
        },
        readinessLift,
        goalLift,
      },
      verdict: {
        meetsLiftThreshold,
        recommendation: meetsLiftThreshold
          ? "KEEP — Gamification shows measurable behavioral lift. Continue and consider expanding."
          : withAnyAchievement === 0
            ? "INSUFFICIENT DATA — No students have earned achievements yet. Too early to evaluate."
            : "REVIEW — Gamification is not showing measurable lift. Consider simplifying or removing.",
      },
    },
  });
});
