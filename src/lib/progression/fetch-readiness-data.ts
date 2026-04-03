import { prisma } from "@/lib/db";
import { type ProgressionState } from "./engine";
import { type ReadinessResult } from "./readiness-score";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";

export interface StudentReadinessData {
  state: ProgressionState;
  readiness: ReadinessResult;
  orientationProgress: { completed: number; total: number };
  bhagCompleted: boolean;
  hasProgressionRecord: boolean;
}

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
    hasProgressionRecord: progression !== null,
  };
}
