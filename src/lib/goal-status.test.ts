/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
// =============================================================================
// VQ-R-011 — goal-status side effects must ride every transition path.
//
// The student PATCH route invalidated the goals cache, ensured level
// progression, and awarded BHAG-completion XP; Sage's update_goal_status tool
// did a bare prisma.goal.update and skipped all three. Both now call this
// module — these tests pin the effect contract.
// =============================================================================
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockGoalUpdate = mock.fn(async () => ({ id: "goal-1", level: "weekly", status: "completed" })) as any;
const mockInvalidatePrefix = mock.fn() as any;
const mockEnsureProgression = mock.fn(async () => undefined) as any;
const mockUpdateProgression = mock.fn(async () => undefined) as any;
const recordBhagCompletedSentinel = (state: unknown) => state;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      goal: {
        get update() {
          return mockGoalUpdate;
        },
      },
    },
  },
});

mock.module("@/lib/cache", {
  namedExports: { invalidatePrefix: mockInvalidatePrefix },
});

mock.module("@/lib/goal-progression", {
  namedExports: { ensureGoalLevelProgression: mockEnsureProgression },
});

mock.module("@/lib/goals", {
  namedExports: {
    goalCountsTowardPlan: (status: string) => ["active", "in_progress", "confirmed", "completed"].includes(status),
    isGoalLevel: (level: string) => ["bhag", "monthly", "weekly", "daily", "task"].includes(level),
  },
});

mock.module("@/lib/progression/engine", {
  namedExports: { recordBhagCompleted: recordBhagCompletedSentinel },
});

mock.module("@/lib/progression/service", {
  namedExports: { updateProgression: mockUpdateProgression },
});

let goalStatus: typeof import("./goal-status");

before(async () => {
  goalStatus = await import("./goal-status");
});

beforeEach(() => {
  mockGoalUpdate.mock.resetCalls();
  mockInvalidatePrefix.mock.resetCalls();
  mockEnsureProgression.mock.resetCalls();
  mockUpdateProgression.mock.resetCalls();
  mockGoalUpdate.mock.mockImplementation(async () => ({ id: "goal-1", level: "weekly", status: "completed" }));
});

describe("transitionGoalStatus (VQ-R-011 shared write path)", () => {
  it("updates the goal, invalidates the cache, and ensures level progression", async () => {
    const updated = await goalStatus.transitionGoalStatus({
      studentId: "stu-1",
      goalId: "goal-1",
      status: "completed",
    });

    assert.equal(updated.status, "completed");
    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    assert.deepEqual(mockGoalUpdate.mock.calls[0].arguments[0].where, { id: "goal-1" });
    assert.deepEqual(mockInvalidatePrefix.mock.calls[0].arguments, ["goals:stu-1"]);
    assert.equal(mockEnsureProgression.mock.callCount(), 1);
    assert.deepEqual(mockEnsureProgression.mock.calls[0].arguments, ["stu-1", ["weekly"]]);
  });

  it("awards BHAG completion progression when a bhag is completed", async () => {
    mockGoalUpdate.mock.mockImplementation(async () => ({ id: "goal-1", level: "bhag", status: "completed" }));

    await goalStatus.transitionGoalStatus({ studentId: "stu-1", goalId: "goal-1", status: "completed" });

    assert.equal(mockUpdateProgression.mock.callCount(), 1);
    assert.equal(mockUpdateProgression.mock.calls[0].arguments[0], "stu-1");
    assert.equal(mockUpdateProgression.mock.calls[0].arguments[1], recordBhagCompletedSentinel);
  });

  it("does not award BHAG progression for non-bhag or non-completed transitions", async () => {
    mockGoalUpdate.mock.mockImplementation(async () => ({ id: "goal-1", level: "weekly", status: "paused" }));

    await goalStatus.transitionGoalStatus({ studentId: "stu-1", goalId: "goal-1", status: "paused" });

    assert.equal(mockUpdateProgression.mock.callCount(), 0);
    // paused does not count toward the plan, so no level progression either.
    assert.equal(mockEnsureProgression.mock.callCount(), 0);
    // The cache is still invalidated on every transition.
    assert.equal(mockInvalidatePrefix.mock.callCount(), 1);
  });

  it("applyGoalStatusEffects runs the same effects for route-driven updates", async () => {
    await goalStatus.applyGoalStatusEffects("stu-2", { id: "goal-9", level: "bhag", status: "completed" });

    assert.deepEqual(mockInvalidatePrefix.mock.calls[0].arguments, ["goals:stu-2"]);
    assert.equal(mockEnsureProgression.mock.callCount(), 1);
    assert.equal(mockUpdateProgression.mock.callCount(), 1);
    assert.equal(mockGoalUpdate.mock.callCount(), 0);
  });
});
