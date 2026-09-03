import type { GoalStatus } from "@/lib/goals";

export interface LockableGoal {
  id: string;
  status: GoalStatus;
  parentId: string | null;
}

/** Shown beside complete toggles that are locked because a goal above them is still a Sage proposal. */
export const PROPOSED_TOGGLE_HINT = "Your instructor needs to confirm this goal before you can check off its steps.";

const MAX_ANCESTOR_DEPTH = 20;

/**
 * A goal cannot be checked off while it, or any goal above it, is still a Sage
 * proposal awaiting instructor confirmation. The server refuses the write; this
 * keeps the client from offering a control that cannot succeed.
 */
export function isLockedByProposal(goal: LockableGoal, goalsById: ReadonlyMap<string, LockableGoal>): boolean {
  let current: LockableGoal | undefined = goal;
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (current.status === "proposed") return true;
    current = current.parentId ? goalsById.get(current.parentId) : undefined;
  }
  return false;
}
