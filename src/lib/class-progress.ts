import { prisma } from "@/lib/db";
import { parseState } from "@/lib/progression/engine";
import { fetchReadinessDataForStudents } from "@/lib/progression/fetch-readiness-data";

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

  // This week's completions need the raw progression rows (see below), so
  // this stays a direct query — separate from the readiness score, which now
  // comes from the batched reconciled loader.
  const progressions = await prisma.progression.findMany({
    where: { studentId: { in: classmateIds } },
    select: { studentId: true, state: true },
  });

  // Ticket D1 (2026-09-07): the readiness score is the SAME reconciled
  // mapping every other surface uses (readiness-consumers.ts), reached
  // through the batched loader so a class of any size costs a constant
  // number of queries. A classmate with no Progression row still gets a real
  // reconciled score here (buildReadinessSnapshot starts from the initial
  // state when progressionState is null) rather than the implicit 0 this
  // loop used to produce by skipping them.
  const readinessByStudent = await fetchReadinessDataForStudents(classmateIds);
  let readinessSum = 0;
  for (const id of classmateIds) {
    readinessSum += readinessByStudent.get(id)?.readiness.score ?? 0;
  }
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
