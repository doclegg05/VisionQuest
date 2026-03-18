export interface ReadinessBreakdown {
  orientation: { score: number; max: number; label: string };
  goals: { score: number; max: number; label: string };
  certifications: { score: number; max: number; label: string };
  portfolio: { score: number; max: number; label: string };
  platforms: { score: number; max: number; label: string };
  consistency: { score: number; max: number; label: string };
  progress: { score: number; max: number; label: string };
}

export interface ReadinessResult {
  score: number;
  breakdown: ReadinessBreakdown;
}

export function computeReadinessScore(
  state: {
    orientationComplete: boolean;
    completedGoalLevels: string[];
    certificationsEarned: number;
    portfolioItemCount: number;
    resumeCreated: boolean;
    portfolioShared: boolean;
    platformsVisited: string[];
    longestStreak: number;
    level: number;
  },
  totalCerts: number = 19,
  totalPlatforms: number = 13
): ReadinessResult {
  // Orientation (15 pts): all or nothing
  const orientationScore = state.orientationComplete ? 15 : 0;

  // Goals (15 pts): 3 per level (bhag, monthly, weekly, daily, task)
  const goalLevels = ["bhag", "monthly", "weekly", "daily", "task"];
  const goalsScore = Math.min(
    15,
    state.completedGoalLevels.filter((l) => goalLevels.includes(l)).length * 3
  );

  // Certifications (25 pts): proportional to total
  const certsScore = Math.min(
    25,
    Math.round((state.certificationsEarned / totalCerts) * 25)
  );

  // Portfolio (15 pts): resume=5, items=2 each up to 4 items (8), shared=2
  let portfolioScore = 0;
  if (state.resumeCreated) portfolioScore += 5;
  portfolioScore += Math.min(8, state.portfolioItemCount * 2);
  if (state.portfolioShared) portfolioScore += 2;
  portfolioScore = Math.min(15, portfolioScore);

  // Platforms (10 pts): proportional
  const platformsScore = Math.min(
    10,
    Math.round((state.platformsVisited.length / totalPlatforms) * 10)
  );

  // Consistency (10 pts): streak milestones
  let consistencyScore = 0;
  if (state.longestStreak >= 30) consistencyScore = 10;
  else if (state.longestStreak >= 14) consistencyScore = 6;
  else if (state.longestStreak >= 7) consistencyScore = 3;

  // Progress (10 pts): level-based
  const progressScore = Math.round(((state.level - 1) / 4) * 10);

  const score =
    orientationScore +
    goalsScore +
    certsScore +
    portfolioScore +
    platformsScore +
    consistencyScore +
    progressScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      orientation: { score: orientationScore, max: 15, label: "Orientation" },
      goals: { score: goalsScore, max: 15, label: "Goals" },
      certifications: { score: certsScore, max: 25, label: "Certifications" },
      portfolio: { score: portfolioScore, max: 15, label: "Portfolio" },
      platforms: { score: platformsScore, max: 10, label: "Platforms" },
      consistency: { score: consistencyScore, max: 10, label: "Consistency" },
      progress: { score: progressScore, max: 10, label: "Progress" },
    },
  };
}
