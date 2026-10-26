import { prisma } from "@/lib/db";
import { type ProgressionState } from "./engine";
import { type ReadinessResult } from "./readiness-score";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";

export interface StudentReadinessData {
  state: ProgressionState;
  readiness: ReadinessResult;
  orientationProgress: { completed: number; total: number };
  bhagCompleted: boolean;
}

/**
 * No `hasProgressionRecord` here on purpose. The Progression row is created as
 * a side effect of the daily check-in that GET /api/progression awards on every
 * student page mount, so its existence describes the app's own behaviour, not
 * the student's. Routing that once read it now reads a recorded fact instead —
 * see src/lib/progression/welcome-routing.ts.
 */

export async function fetchStudentReadinessData(studentId: string): Promise<StudentReadinessData> {
  const [
    progression,
    orientationDoneCount,
    orientationTotalCount,
    bhagGoal,
    certificationsEarned,
    portfolioItemCount,
    resumeData,
    publicPage,
  ] = await Promise.all([
    prisma.progression.findUnique({ where: { studentId }, select: { state: true } }),
    prisma.orientationProgress.count({ where: { studentId, completed: true } }),
    prisma.orientationItem.count(),
    prisma.goal.findFirst({
      where: { studentId, level: "bhag", status: "completed" },
      select: { id: true },
    }),
    prisma.certification.count({ where: { studentId, status: "completed" } }),
    prisma.portfolioItem.count({ where: { studentId } }),
    prisma.resumeData.findUnique({ where: { studentId }, select: { id: true } }),
    prisma.publicCredentialPage.findUnique({
      where: { studentId },
      select: { isPublic: true },
    }),
  ]);

  const bhagCompleted = !!bhagGoal;
  const snapshot = buildReadinessSnapshot({
    progressionState: progression?.state ?? null,
    orientationCompletedCount: orientationDoneCount,
    orientationTotalCount,
    bhagCompleted,
    certificationsEarned,
    portfolioItemCount,
    hasResume: Boolean(resumeData),
    portfolioShared: Boolean(publicPage?.isPublic),
  });

  return {
    state: snapshot.state,
    readiness: snapshot.readiness,
    orientationProgress: snapshot.orientationProgress,
    bhagCompleted,
  };
}

/**
 * Batched sibling of `fetchStudentReadinessData`, for a surface that renders
 * many students at once (Ticket D1: the teacher roster, the class-progress
 * panel, the academic KPI report). One query per fact table, each scoped with
 * `studentId: { in: ids }` — never one query per student — so the query count
 * stays constant as the page or class grows, unlike the per-student version
 * this wraps the same reconciliation logic around.
 *
 * Returns the SAME reconciled score `fetchStudentReadinessData` would compute
 * for each id, one at a time, given the current database state — this is not
 * a second mapping, just a batched way to reach the one mapping every surface
 * now uses (`reconciledReadiness` / `buildReadinessSnapshot`).
 */
export async function fetchReadinessDataForStudents(
  ids: string[],
): Promise<Map<string, StudentReadinessData>> {
  if (ids.length === 0) return new Map();

  const [
    progressions,
    orientationDoneCounts,
    orientationTotalCount,
    bhagGoals,
    certificationCounts,
    portfolioItemCounts,
    resumeRows,
    sharedPages,
  ] = await Promise.all([
    prisma.progression.findMany({
      where: { studentId: { in: ids } },
      select: { studentId: true, state: true },
    }),
    prisma.orientationProgress.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, completed: true },
      _count: true,
    }),
    prisma.orientationItem.count(),
    prisma.goal.findMany({
      where: { studentId: { in: ids }, level: "bhag", status: "completed" },
      select: { studentId: true },
      distinct: ["studentId"],
    }),
    prisma.certification.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, status: "completed" },
      _count: true,
    }),
    prisma.portfolioItem.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids } },
      _count: true,
    }),
    prisma.resumeData.findMany({
      where: { studentId: { in: ids } },
      select: { studentId: true },
    }),
    prisma.publicCredentialPage.findMany({
      where: { studentId: { in: ids }, isPublic: true },
      select: { studentId: true },
    }),
  ]);

  const progressionByStudent = new Map(progressions.map((row) => [row.studentId, row.state]));
  const orientationDoneByStudent = new Map(
    orientationDoneCounts.map((row) => [row.studentId, row._count]),
  );
  const bhagCompletedIds = new Set(bhagGoals.map((row) => row.studentId));
  const certificationsByStudent = new Map(
    certificationCounts.map((row) => [row.studentId, row._count]),
  );
  const portfolioItemsByStudent = new Map(
    portfolioItemCounts.map((row) => [row.studentId, row._count]),
  );
  const hasResumeIds = new Set(resumeRows.map((row) => row.studentId));
  const portfolioSharedIds = new Set(sharedPages.map((row) => row.studentId));

  const result = new Map<string, StudentReadinessData>();
  for (const studentId of ids) {
    const bhagCompleted = bhagCompletedIds.has(studentId);
    const snapshot = buildReadinessSnapshot({
      progressionState: progressionByStudent.get(studentId) ?? null,
      orientationCompletedCount: orientationDoneByStudent.get(studentId) ?? 0,
      orientationTotalCount,
      bhagCompleted,
      certificationsEarned: certificationsByStudent.get(studentId) ?? 0,
      portfolioItemCount: portfolioItemsByStudent.get(studentId) ?? 0,
      hasResume: hasResumeIds.has(studentId),
      portfolioShared: portfolioSharedIds.has(studentId),
    });

    result.set(studentId, {
      state: snapshot.state,
      readiness: snapshot.readiness,
      orientationProgress: snapshot.orientationProgress,
      bhagCompleted,
    });
  }

  return result;
}
