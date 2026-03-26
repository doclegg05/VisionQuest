export interface ReadinessBreakdown {
  orientation: { score: number; max: number; label: string };
  goalPlanning: { score: number; max: number; label: string };
  bhagAchieved: { score: number; max: number; label: string };
  certifications: { score: number; max: number; label: string };
  portfolio: { score: number; max: number; label: string };
  consistency: { score: number; max: number; label: string };
}

export interface ReadinessResult {
  score: number;
  breakdown: ReadinessBreakdown;
}

export function computeReadinessScore(
  state: {
    orientationComplete: boolean;
    orientationProgress?: { completed: number; total: number };
    completedGoalLevels: string[];
    bhagCompleted: boolean;
    certificationsEarned: number;
    portfolioItemCount: number;
    resumeCreated: boolean;
    portfolioShared: boolean;
    longestStreak: number;
  },
  totalCerts: number = 19,
): ReadinessResult {
  // Orientation (10 pts): program forms and checklist
  let orientationScore: number;
  if (state.orientationComplete) {
    orientationScore = 10;
  } else if (state.orientationProgress && state.orientationProgress.total > 0) {
    orientationScore = Math.round(
      (state.orientationProgress.completed / state.orientationProgress.total) * 10,
    );
  } else {
    orientationScore = 0;
  }

  // Goal Planning (15 pts): 3 per level (bhag, monthly, weekly, daily, task)
  const goalLevels = ["bhag", "monthly", "weekly", "daily", "task"];
  const goalPlanningScore = Math.min(
    15,
    state.completedGoalLevels.filter((l) => goalLevels.includes(l)).length * 3,
  );

  // BHAG Achieved (20 pts): student's big goal marked complete
  const bhagScore = state.bhagCompleted ? 20 : 0;

  // Certifications (25 pts): industry credentials earned
  const certsScore = Math.min(
    25,
    Math.round((state.certificationsEarned / totalCerts) * 25),
  );

  // Resume & Portfolio (20 pts): resume=8, items=2 each up to 4 (8), shared=4
  let portfolioScore = 0;
  if (state.resumeCreated) portfolioScore += 8;
  portfolioScore += Math.min(8, state.portfolioItemCount * 2);
  if (state.portfolioShared) portfolioScore += 4;
  portfolioScore = Math.min(20, portfolioScore);

  // Consistency (10 pts): streak milestones (shows discipline)
  let consistencyScore = 0;
  if (state.longestStreak >= 30) consistencyScore = 10;
  else if (state.longestStreak >= 14) consistencyScore = 6;
  else if (state.longestStreak >= 7) consistencyScore = 3;

  const score =
    orientationScore +
    goalPlanningScore +
    bhagScore +
    certsScore +
    portfolioScore +
    consistencyScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      orientation: { score: orientationScore, max: 10, label: "Orientation" },
      goalPlanning: { score: goalPlanningScore, max: 15, label: "Goal Planning" },
      bhagAchieved: { score: bhagScore, max: 20, label: "Big Goal Achieved" },
      certifications: { score: certsScore, max: 25, label: "Certifications" },
      portfolio: { score: portfolioScore, max: 20, label: "Resume & Portfolio" },
      consistency: { score: consistencyScore, max: 10, label: "Consistency" },
    },
  };
}
