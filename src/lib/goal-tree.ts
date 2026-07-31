// =============================================================================
// Goal tree — pure forest construction for the goal hierarchy (VQ-R-008).
//
// The goals page previously derived its sections from seven ad-hoc filter
// passes whose gaps let goals COUNT toward progress while never rendering:
// a task nested under weekly→daily depth, any orphan daily/task with a
// parentId, and the "direct tasks on this monthly" list that was filtered
// from a set that could never contain them. This module owns the shape:
// every active goal appears in the page model EXACTLY once (the totality
// invariant pinned in goal-tree.test.ts), including cycle and missing-parent
// pathologies, which degrade to visible orphans instead of vanishing.
// =============================================================================

export interface GoalNodeInput {
  id: string;
  parentId: string | null;
  level: string;
  status: string;
}

export interface GoalTreeNode<T extends GoalNodeInput> {
  goal: T;
  children: GoalTreeNode<T>[];
}

/** Which child levels a parent level may hold — the write-time lattice. */
const GOAL_CHILD_LEVELS: Record<string, ReadonlyArray<string>> = {
  bhag: ["monthly"],
  monthly: ["weekly", "daily", "task"],
  weekly: ["daily", "task"],
  daily: ["task"],
  task: [],
};

export function isValidGoalParentLevel(parentLevel: string, childLevel: string): boolean {
  return (GOAL_CHILD_LEVELS[parentLevel] ?? []).includes(childLevel);
}

/**
 * Build a forest over the given goals. A goal whose parentId is null, absent
 * from the input, or part of a parent cycle becomes a root — nothing is ever
 * dropped. Children preserve input order.
 */
export function buildGoalTree<T extends GoalNodeInput>(
  goals: T[],
): { roots: GoalTreeNode<T>[]; byId: Map<string, GoalTreeNode<T>> } {
  const byId = new Map<string, GoalTreeNode<T>>();
  for (const goal of goals) {
    byId.set(goal.id, { goal, children: [] });
  }

  // Detect parent cycles: walk each node's parent chain; any node whose
  // chain revisits a seen id (including itself) is treated as a root so the
  // cycle's members stay visible.
  const cycleRoots = new Set<string>();
  for (const goal of goals) {
    const seen = new Set<string>([goal.id]);
    let currentParent = goal.parentId;
    while (currentParent && byId.has(currentParent)) {
      if (seen.has(currentParent)) {
        cycleRoots.add(goal.id);
        break;
      }
      seen.add(currentParent);
      currentParent = byId.get(currentParent)!.goal.parentId;
    }
  }

  const roots: GoalTreeNode<T>[] = [];
  for (const goal of goals) {
    const node = byId.get(goal.id)!;
    const parent = goal.parentId ? byId.get(goal.parentId) : undefined;
    if (!parent || cycleRoots.has(goal.id)) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  return { roots, byId };
}

export interface GoalsPageModel<T extends GoalNodeInput> {
  /** BHAG-level goals, flat (rendered as vision cards). */
  bhags: T[];
  /** Every monthly-level goal as a subtree root, wherever it sat in the forest. */
  monthlyRoots: GoalTreeNode<T>[];
  /**
   * The rows a monthly card renders and counts, depth 0 = direct child.
   * Ownership cuts at monthly/bhag boundaries: a nested monthly (or bhag)
   * renders via its OWN card, so it and its subtree are never claimed here.
   */
  cardRowsByMonthlyId: Map<string, Array<{ goal: T; depth: number }>>;
  /** The card rows' goals, flat — the progress denominator per monthly. */
  descendantsByMonthlyId: Map<string, T[]>;
  /**
   * Every active goal that is neither a bhag, nor a monthly, nor claimed by
   * a monthly card — flattened root-first with depth for indented rendering.
   * This is the "never rendered" class the review flagged.
   */
  orphanRows: Array<{ goal: T; depth: number }>;
}

/**
 * Descendant rows of a node (node itself excluded), depth 0 = direct child,
 * cutting at monthly/bhag boundaries — those render as their own cards.
 */
export function flattenGoalRows<T extends GoalNodeInput>(
  node: GoalTreeNode<T>,
): Array<{ goal: T; depth: number }> {
  const rows: Array<{ goal: T; depth: number }> = [];
  const visit = (n: GoalTreeNode<T>, depth: number): void => {
    for (const child of n.children) {
      if (child.goal.level === "monthly" || child.goal.level === "bhag") continue;
      rows.push({ goal: child.goal, depth });
      visit(child, depth + 1);
    }
  };
  visit(node, 0);
  return rows;
}

/**
 * Shape the forest into exactly what the goals page renders. Totality: every
 * input goal lands in exactly one of bhags / monthlyRoots(+descendants) /
 * orphanRows.
 */
export function buildGoalsPageModel<T extends GoalNodeInput>(goals: T[]): GoalsPageModel<T> {
  const { roots, byId } = buildGoalTree(goals);

  const bhags = goals.filter((g) => g.level === "bhag");
  const monthlyRoots: GoalTreeNode<T>[] = [];
  const cardRowsByMonthlyId = new Map<string, Array<{ goal: T; depth: number }>>();
  const descendantsByMonthlyId = new Map<string, T[]>();

  // Membership of monthly cards (the monthly itself + its bounded rows).
  const insideMonthly = new Set<string>();
  for (const goal of goals) {
    if (goal.level !== "monthly") continue;
    const node = byId.get(goal.id)!;
    monthlyRoots.push(node);
    insideMonthly.add(goal.id);
    const rows = flattenGoalRows(node);
    for (const row of rows) insideMonthly.add(row.goal.id);
    cardRowsByMonthlyId.set(goal.id, rows);
    descendantsByMonthlyId.set(
      goal.id,
      rows.map((row) => row.goal),
    );
  }

  const orphanRows: Array<{ goal: T; depth: number }> = [];
  // Walk every root; emit each goal that is neither a bhag, nor a monthly,
  // nor inside a monthly subtree — with its depth relative to the nearest
  // emitted ancestor. Excluded nodes reset depth for their children, so even
  // pathological nestings (a monthly under a weekly) emit each goal once.
  const walk = (node: GoalTreeNode<T>, depth: number | null): void => {
    const g = node.goal;
    const excluded = g.level === "bhag" || g.level === "monthly" || insideMonthly.has(g.id);
    if (excluded) {
      for (const child of node.children) walk(child, null);
      return;
    }
    const rowDepth = depth ?? 0;
    orphanRows.push({ goal: g, depth: rowDepth });
    for (const child of node.children) walk(child, rowDepth + 1);
  };
  for (const root of roots) walk(root, null);

  return { bhags, monthlyRoots, cardRowsByMonthlyId, descendantsByMonthlyId, orphanRows };
}
