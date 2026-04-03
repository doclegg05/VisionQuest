import {
  createInitialState,
  parseState,
  type ProgressionState,
} from "@/lib/progression/engine";
import {
  computeReadinessScore,
  type ReadinessResult,
} from "@/lib/progression/readiness-score";

export interface ReadinessSnapshotInput {
  progressionState: string | null;
  orientationCompletedCount: number;
  orientationTotalCount: number;
  bhagCompleted: boolean;
  certificationsEarned: number;
  portfolioItemCount: number;
  hasResume: boolean;
  portfolioShared: boolean;
  totalCertifications?: number;
}

export interface ReadinessSnapshot {
  state: ProgressionState;
  readiness: ReadinessResult;
  orientationProgress: {
    completed: number;
    total: number;
  };
  bhagCompleted: boolean;
}

export function buildReadinessSnapshot(
  input: ReadinessSnapshotInput,
): ReadinessSnapshot {
  const state = input.progressionState
    ? parseState(input.progressionState)
    : createInitialState();

  const orientationProgress = {
    completed: input.orientationCompletedCount,
    total: input.orientationTotalCount,
  };
  const orientationComplete =
    state.orientationComplete ||
    (orientationProgress.total > 0 &&
      orientationProgress.completed >= orientationProgress.total);

  if (!state.resumeCreated && input.hasResume) {
    state.resumeCreated = true;
  }
  if (!state.portfolioShared && input.portfolioShared) {
    state.portfolioShared = true;
  }

  const resolvedCertificationsEarned = Math.max(
    state.certificationsEarned,
    input.certificationsEarned,
  );
  const resolvedPortfolioItemCount = Math.max(
    state.portfolioItemCount,
    input.portfolioItemCount,
  );

  state.orientationComplete = orientationComplete;
  state.certificationsEarned = resolvedCertificationsEarned;
  state.portfolioItemCount = resolvedPortfolioItemCount;
  state.bhagCompleted = input.bhagCompleted;

  const readiness = computeReadinessScore(
    {
      ...state,
      orientationComplete,
      orientationProgress,
      bhagCompleted: input.bhagCompleted,
      certificationsEarned: resolvedCertificationsEarned,
      portfolioItemCount: resolvedPortfolioItemCount,
    },
    input.totalCertifications,
  );

  return {
    state,
    readiness,
    orientationProgress,
    bhagCompleted: input.bhagCompleted,
  };
}
