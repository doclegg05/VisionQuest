export interface GoalForStalenessCheck {
  level: string;
  status: string;
  updatedAt: Date;
  lastReviewedAt: Date | null;
}

export const TERMINAL_GOAL_STATUSES = ["completed", "archived", "cancelled", "abandoned"] as const;

const TERMINAL_STATUSES = new Set<string>(TERMINAL_GOAL_STATUSES);

const STALENESS_THRESHOLDS_BY_LEVEL: Record<string, number> = {
  daily: 3,
  weekly: 7,
  monthly: 14,
  quarterly: 30,
  bhag: 60,
};

const DEFAULT_THRESHOLD_DAYS = 14;

const HIGH_SEVERITY_DAYS = 14;

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

export interface GoalStaleAlert {
  alertKey: string;
  type: "goal_stale";
  severity: "medium" | "high";
  title: string;
  summary: string;
  sourceType: "goal";
  sourceId: string;
}

/**
 * The goal_stale alert for one goal, or null when the goal is not stale.
 *
 * Two writers upsert this alert under the same key: the alert sync
 * (src/lib/advising-alerts.ts, on student or staff activity) and the daily
 * goal-stale-detection job (src/app/api/internal/goal-stale-detection, for
 * every student). Each resolves the other's open alerts when its own rule
 * disagrees, so both build the alert here, from the same rule the
 * intervention queue's stalled-goal count uses.
 */
export function buildGoalStaleAlert(
  goal: GoalForStalenessCheck & { id: string },
  now: Date = new Date(),
): GoalStaleAlert | null {
  if (!isGoalStale(goal, now)) {
    return null;
  }

  const days = daysSince(goal.lastReviewedAt ?? goal.updatedAt, now);
  const levelLabel = goal.level.charAt(0).toUpperCase() + goal.level.slice(1);
  const measuredFrom = goal.lastReviewedAt ? "reviewed" : "updated";

  return {
    alertKey: `goal_stale:${goal.id}`,
    type: "goal_stale",
    severity: days >= HIGH_SEVERITY_DAYS ? "high" : "medium",
    title: `${levelLabel} goal needs review`,
    summary: `${levelLabel} goal has not been ${measuredFrom} in ${days} days.`,
    sourceType: "goal",
    sourceId: goal.id,
  };
}
