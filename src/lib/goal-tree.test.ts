// =============================================================================
// VQ-R-008 — every active goal renders exactly once (totality invariant).
//
// The goals page's ad-hoc filters let goals count toward progress while never
// rendering (deep-nested tasks, orphan dailies/tasks with a parentId, direct
// monthly tasks filtered from a set that couldn't contain them). The page
// model must place every goal in exactly one rendered bucket, even for
// pathological data: missing parents, cycles, mis-leveled nestings.
// =============================================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGoalsPageModel, isValidGoalParentLevel, type GoalNodeInput } from "./goal-tree";

interface TestGoal extends GoalNodeInput {
  id: string;
  parentId: string | null;
  level: string;
  status: string;
}

function goal(id: string, level: string, parentId: string | null = null, status = "active"): TestGoal {
  return { id, level, parentId, status };
}

/**
 * Where the page model places each goal, for totality accounting:
 * bhag cards + monthly cards (the monthly itself + its bounded rows) +
 * orphan rows. Ownership cuts at monthly/bhag boundaries, so summing the
 * buckets must reproduce the input exactly.
 */
function renderedIds(goals: TestGoal[]): string[] {
  const model = buildGoalsPageModel(goals);
  const ids: string[] = [];
  ids.push(...model.bhags.map((g) => g.id));
  for (const node of model.monthlyRoots) {
    ids.push(node.goal.id);
    for (const row of model.cardRowsByMonthlyId.get(node.goal.id) ?? []) {
      ids.push(row.goal.id);
    }
  }
  ids.push(...model.orphanRows.map((r) => r.goal.id));
  return ids;
}

describe("buildGoalsPageModel totality (VQ-R-008)", () => {
  const messyForest: TestGoal[] = [
    goal("b1", "bhag"),
    goal("m1", "monthly", "b1"),
    goal("w1", "weekly", "m1"),
    goal("d1", "daily", "w1"),
    goal("t1", "task", "d1"), // depth 4 under the monthly — previously dropped
    goal("t2", "task", "m1"), // direct monthly task — previously never rendered
    goal("w2", "weekly", "b1"), // weekly under bhag — orphan section
    goal("t3", "task", "w2"), // child of an orphan weekly — previously dropped
    goal("t4", "task", "missing-parent"), // dangling parent — previously dropped
    goal("d2", "daily", null), // parentless daily
    goal("c1", "weekly", "c2"), // cycle
    goal("c2", "daily", "c1"), // cycle
  ];

  it("places every goal exactly once across bhags, monthly cards, and orphan rows", () => {
    const ids = renderedIds(messyForest).sort();
    const expected = messyForest.map((g) => g.id).sort();
    assert.deepEqual(ids, expected);
  });

  it("counts deep descendants toward the monthly progress denominator", () => {
    const model = buildGoalsPageModel(messyForest);
    const descendants = model.descendantsByMonthlyId.get("m1")!.map((g) => g.id).sort();
    assert.deepEqual(descendants, ["d1", "t1", "t2", "w1"]);
  });

  it("surfaces cycle members and dangling-parent goals as orphan rows", () => {
    const model = buildGoalsPageModel(messyForest);
    const orphanIds = model.orphanRows.map((r) => r.goal.id);
    for (const id of ["t4", "d2", "c1", "c2", "w2", "t3"]) {
      assert.ok(orphanIds.includes(id), `expected orphan rows to include ${id}`);
    }
  });

  it("indents orphan children beneath their orphan parent", () => {
    const model = buildGoalsPageModel(messyForest);
    const w2 = model.orphanRows.find((r) => r.goal.id === "w2")!;
    const t3 = model.orphanRows.find((r) => r.goal.id === "t3")!;
    assert.equal(w2.depth, 0);
    assert.equal(t3.depth, 1);
  });

  it("holds totality across seeded random forests", () => {
    // Deterministic LCG so failures reproduce.
    let seed = 1337;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const levels = ["bhag", "monthly", "weekly", "daily", "task"];
    for (let iteration = 0; iteration < 40; iteration++) {
      const count = 5 + Math.floor(rand() * 55);
      const goals: TestGoal[] = [];
      for (let i = 0; i < count; i++) {
        const level = levels[Math.floor(rand() * levels.length)];
        // Parents may be any earlier goal, a FUTURE goal (forward reference),
        // a missing id, self, or null — the generator is deliberately hostile.
        const roll = rand();
        let parentId: string | null = null;
        if (roll < 0.5 && i > 0) parentId = `g${Math.floor(rand() * count)}`;
        else if (roll < 0.6) parentId = "nope";
        else if (roll < 0.65) parentId = `g${i}`; // self-cycle
        goals.push(goal(`g${i}`, level, parentId));
      }
      const ids = renderedIds(goals).sort();
      const expected = goals.map((g) => g.id).sort();
      assert.deepEqual(ids, expected, `totality violated at iteration ${iteration}`);
    }
  });
});

describe("isValidGoalParentLevel — the write-time lattice (VQ-R-008)", () => {
  it("allows exactly the documented parent/child pairs", () => {
    assert.equal(isValidGoalParentLevel("bhag", "monthly"), true);
    assert.equal(isValidGoalParentLevel("monthly", "weekly"), true);
    assert.equal(isValidGoalParentLevel("monthly", "task"), true);
    assert.equal(isValidGoalParentLevel("monthly", "daily"), true);
    assert.equal(isValidGoalParentLevel("weekly", "daily"), true);
    assert.equal(isValidGoalParentLevel("weekly", "task"), true);
    assert.equal(isValidGoalParentLevel("daily", "task"), true);
  });

  it("rejects inverted or skipping pairs", () => {
    assert.equal(isValidGoalParentLevel("task", "weekly"), false);
    assert.equal(isValidGoalParentLevel("weekly", "monthly"), false);
    assert.equal(isValidGoalParentLevel("bhag", "task"), false);
    assert.equal(isValidGoalParentLevel("daily", "daily"), false);
    assert.equal(isValidGoalParentLevel("unknown", "task"), false);
  });
});
