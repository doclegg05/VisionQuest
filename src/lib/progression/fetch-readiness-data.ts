import { prisma } from "@/lib/db";
import { parseState, createInitialState, type ProgressionState } from "./engine";
import { computeReadinessScore, type ReadinessResult } from "./readiness-score";

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

  const state = progression ? parseState(progression.state) : createInitialState();

  // Reconcile DB-sourced values with progression state to ensure consistency
  if (!state.resumeCreated && resumeData) {
    state.resumeCreated = true;
  }
  if (!state.portfolioShared && publicPage?.isPublic) {
    state.portfolioShared = true;
  }

  const bhagCompleted = !!bhagGoal;
  const orientationProgress = { completed: orientationDoneCount, total: orientationTotalCount };

  // Use DB counts as the authoritative source for certifications and portfolio items,
  // falling back to state when the DB count is higher (handles edge cases where
  // progression state may be ahead of direct DB counts).
  const resolvedCertsEarned = Math.max(state.certificationsEarned, certificationsEarned);
  const resolvedPortfolioItemCount = Math.max(state.portfolioItemCount, portfolioItemCount);

  const readiness = computeReadinessScore({
    ...state,
    bhagCompleted,
    orientationProgress,
    certificationsEarned: resolvedCertsEarned,
    portfolioItemCount: resolvedPortfolioItemCount,
  });

  // Reflect resolved values back onto state for consumers that read state fields directly
  state.certificationsEarned = resolvedCertsEarned;
  state.portfolioItemCount = resolvedPortfolioItemCount;
  state.bhagCompleted = bhagCompleted;

  return {
    state,
    readiness,
    orientationProgress,
    bhagCompleted,
    hasProgressionRecord: progression !== null,
  };
}
