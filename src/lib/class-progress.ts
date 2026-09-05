import { prisma } from "@/lib/db";
import { parseState } from "@/lib/progression/engine";
import { progressionStateReadiness } from "@/lib/progression/readiness-consumers";

export interface ClassProgressStats {
  className: string;
  classmateCount: number;
  avgOrientationPct: number;
  orientationCompletedThisWeek: number;
  avgReadinessScore: number;
}

/**
 * Returns anonymous class-level stats for the given student's active class.
 * Returns null if the student is not enrolled in any class.
 */
export async function getClassProgress(studentId: string): Promise<ClassProgressStats | null> {
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId, status: "active" },
    include: { class: { select: { id: true, name: true } } },
  });

  if (!enrollment) return null;

  const classId = enrollment.class.id;

  const classmates = await prisma.studentClassEnrollment.findMany({
    where: { classId, status: "active" },
    select: { studentId: true },
  });

  const classmateIds = classmates.map((c) => c.studentId);
  if (classmateIds.length === 0) return null;

  const totalOrientation = await prisma.orientationItem.count();

  // Orientation completion per student
  const orientationCounts = await prisma.orientationProgress.groupBy({
    by: ["studentId"],
    where: { studentId: { in: classmateIds }, completed: true },
    _count: true,
  });

  const orientationMap = new Map(orientationCounts.map((o) => [o.studentId, o._count]));
  const avgOrientationPct =
    totalOrientation > 0
      ? Math.round(
          classmateIds.reduce(
            (sum, id) => sum + ((orientationMap.get(id) || 0) / totalOrientation) * 100,
            0
          ) / classmateIds.length
        )
      : 0;

  // Readiness scores from progression state
  const [progressions, bhagCompletions] = await Promise.all([
    prisma.progression.findMany({
      where: { studentId: { in: classmateIds } },
      select: { studentId: true, state: true },
    }),
    prisma.goal.findMany({
      where: { studentId: { in: classmateIds }, level: "bhag", status: "completed" },
      select: { studentId: true },
    }),
  ]);

  const bhagCompletedSet = new Set(bhagCompletions.map((g) => g.studentId));

  let readinessSum = 0;
  for (const prog of progressions) {
    // The mapping lives in readiness-consumers.ts, next to the six other
    // surfaces that render a readiness number, so this one cannot drift away
    // from them unnoticed. `totalOrientation` is prisma.orientationItem.count()
    // — ALL items, per the 2026-07-31 decision.
    const readiness = progressionStateReadiness({
      progressionState: prog.state,
      bhagCompleted: bhagCompletedSet.has(prog.studentId),
      orientationCompletedCount: orientationMap.get(prog.studentId) || 0,
      orientationTotalCount: totalOrientation,
    });
    readinessSum += readiness.score;
  }

  // Students without progression get 0 score — include them in the average
  const avgReadinessScore = Math.round(readinessSum / classmateIds.length);

  // Orientation completions this week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Count students whose progression was updated with orientationComplete this week
  let orientationCompletedThisWeek = 0;
  for (const prog of progressions) {
    const state = parseState(prog.state);
    if (state.orientationComplete) {
      orientationCompletedThisWeek++;
    }
  }

  // For a more accurate "this week" count, use ProgressionEvent if available
  const recentCompletes = await prisma.progressionEvent.count({
    where: {
      studentId: { in: classmateIds },
      eventType: "orientation_complete",
      occurredAt: { gte: weekAgo },
    },
  });
  if (recentCompletes > 0) {
    orientationCompletedThisWeek = recentCompletes;
  }

  return {
    className: enrollment.class.name,
    classmateCount: classmateIds.length,
    avgOrientationPct,
    orientationCompletedThisWeek,
    avgReadinessScore,
  };
}
