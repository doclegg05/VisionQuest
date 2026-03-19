export const GOAL_LEVELS = ["bhag", "monthly", "weekly", "daily", "task"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export const GOAL_LEVEL_META: Record<GoalLevel, { label: string; icon: string }> = {
  bhag: { label: "Big Hairy Audacious Goal", icon: "⭐" },
  monthly: { label: "Monthly Goal", icon: "📅" },
  weekly: { label: "Weekly Goal", icon: "📆" },
  daily: { label: "Daily Goal", icon: "☀️" },
  task: { label: "Action Task", icon: "✅" },
};

export const GOAL_STATUSES = [
  "active",
  "in_progress",
  "blocked",
  "completed",
  "abandoned",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_PLANNING_STATUSES = [
  "active",
  "in_progress",
  "blocked",
  "completed",
] as const satisfies readonly GoalStatus[];

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  in_progress: "In Progress",
  blocked: "Blocked",
  completed: "Completed",
  abandoned: "Abandoned",
};

export function isGoalLevel(value: string): value is GoalLevel {
  return GOAL_LEVELS.includes(value as GoalLevel);
}

export function isGoalStatus(value: string): value is GoalStatus {
  return GOAL_STATUSES.includes(value as GoalStatus);
}

export function goalCountsTowardPlan(status: string): status is (typeof GOAL_PLANNING_STATUSES)[number] {
  return GOAL_PLANNING_STATUSES.includes(status as (typeof GOAL_PLANNING_STATUSES)[number]);
}

export function goalStatusLabel(status: string): string {
  return isGoalStatus(status) ? GOAL_STATUS_LABELS[status] : status;
}
