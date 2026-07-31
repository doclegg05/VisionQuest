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
  "proposed",
  "active",
  "in_progress",
  "confirmed",
  "blocked",
  "completed",
  "abandoned",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_PLANNING_STATUSES = [
  "active",
  "in_progress",
  "confirmed",
  "blocked",
  "completed",
] as const satisfies readonly GoalStatus[];

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  proposed: "Proposed",
  active: "Active",
  in_progress: "In Progress",
  confirmed: "Confirmed",
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

/**
 * True when a goal came from Sage and no instructor has confirmed it yet.
 *
 * VQ-R-005: the single definition of "not the student's to advance". Shared by
 * the PATCH /api/goals/[id] guard (server authority) and the goals UI (badge +
 * disabled checkbox) so the interface can never offer an action the API will
 * reject. Dismissal is still allowed on these; only progress transitions are
 * withheld until a human confirms.
 */
export function isAwaitingInstructorConfirmation(goal: {
  sourceMessageId?: string | null;
  status: string;
  confirmedAt?: Date | string | null;
}): boolean {
  if (!goal.sourceMessageId) return false;
  if (goal.status === "confirmed") return false;
  return !goal.confirmedAt;
}
