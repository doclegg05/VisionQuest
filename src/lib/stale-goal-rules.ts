export interface GoalForStalenessCheck {
  level: string;
  status: string;
  updatedAt: Date;
  lastReviewedAt: Date | null;
}

const TERMINAL_STATUSES = new Set(["completed", "archived", "cancelled", "abandoned"]);

const STALENESS_THRESHOLDS_BY_LEVEL: Record<string, number> = {
  daily: 3,
  weekly: 7,
  monthly: 14,
  quarterly: 30,
  bhag: 60,
};

const DEFAULT_THRESHOLD_DAYS = 14;

function daysSince(date: Date, now: Date): number {
  const ms = now.getTime() - date.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function isGoalStale(goal: GoalForStalenessCheck, now: Date = new Date()): boolean {
  if (TERMINAL_STATUSES.has(goal.status)) {
    return false;
  }

  const referenceDate = goal.lastReviewedAt ?? goal.updatedAt;
  const elapsed = daysSince(referenceDate, now);
  const threshold = STALENESS_THRESHOLDS_BY_LEVEL[goal.level] ?? DEFAULT_THRESHOLD_DAYS;

  return elapsed >= threshold;
}
