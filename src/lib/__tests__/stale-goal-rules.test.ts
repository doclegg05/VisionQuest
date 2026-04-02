import assert from "node:assert/strict";
import test from "node:test";
import { isGoalStale } from "../stale-goal-rules";
import type { GoalForStalenessCheck } from "../stale-goal-rules";

function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

const NOW = new Date("2026-04-01T12:00:00.000Z");

test("returns false for a recently reviewed goal", () => {
  const goal: GoalForStalenessCheck = {
    level: "monthly",
    status: "active",
    updatedAt: daysAgo(20, NOW),
    lastReviewedAt: daysAgo(5, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), false);
});

test("returns true for a monthly goal not reviewed in 14+ days", () => {
  const goal: GoalForStalenessCheck = {
    level: "monthly",
    status: "active",
    updatedAt: daysAgo(20, NOW),
    lastReviewedAt: daysAgo(14, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), true);
});

test("returns true for a weekly goal not reviewed in 7+ days", () => {
  const goal: GoalForStalenessCheck = {
    level: "weekly",
    status: "active",
    updatedAt: daysAgo(10, NOW),
    lastReviewedAt: daysAgo(7, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), true);
});

test("returns false for a completed goal regardless of age", () => {
  const goal: GoalForStalenessCheck = {
    level: "monthly",
    status: "completed",
    updatedAt: daysAgo(90, NOW),
    lastReviewedAt: daysAgo(60, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), false);
});

test("uses updatedAt as fallback when lastReviewedAt is null", () => {
  const staleGoal: GoalForStalenessCheck = {
    level: "monthly",
    status: "active",
    updatedAt: daysAgo(14, NOW),
    lastReviewedAt: null,
  };

  const freshGoal: GoalForStalenessCheck = {
    level: "monthly",
    status: "active",
    updatedAt: daysAgo(5, NOW),
    lastReviewedAt: null,
  };

  assert.equal(isGoalStale(staleGoal, NOW), true);
  assert.equal(isGoalStale(freshGoal, NOW), false);
});

test("returns false for archived goal regardless of age", () => {
  const goal: GoalForStalenessCheck = {
    level: "quarterly",
    status: "archived",
    updatedAt: daysAgo(120, NOW),
    lastReviewedAt: daysAgo(90, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), false);
});

test("returns false for cancelled goal regardless of age", () => {
  const goal: GoalForStalenessCheck = {
    level: "daily",
    status: "cancelled",
    updatedAt: daysAgo(30, NOW),
    lastReviewedAt: daysAgo(30, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), false);
});

test("returns false for an abandoned goal regardless of age", () => {
  const goal: GoalForStalenessCheck = {
    level: "monthly",
    status: "abandoned",
    updatedAt: daysAgo(90, NOW),
    lastReviewedAt: daysAgo(60, NOW),
  };

  assert.equal(isGoalStale(goal, NOW), false);
});

test("uses correct thresholds per level", () => {
  const makeGoal = (level: string, days: number): GoalForStalenessCheck => ({
    level,
    status: "active",
    updatedAt: daysAgo(days + 1, NOW),
    lastReviewedAt: daysAgo(days, NOW),
  });

  // daily: 3 days
  assert.equal(isGoalStale(makeGoal("daily", 3), NOW), true);
  assert.equal(isGoalStale(makeGoal("daily", 2), NOW), false);

  // weekly: 7 days
  assert.equal(isGoalStale(makeGoal("weekly", 7), NOW), true);
  assert.equal(isGoalStale(makeGoal("weekly", 6), NOW), false);

  // quarterly: 30 days
  assert.equal(isGoalStale(makeGoal("quarterly", 30), NOW), true);
  assert.equal(isGoalStale(makeGoal("quarterly", 29), NOW), false);

  // bhag: 60 days
  assert.equal(isGoalStale(makeGoal("bhag", 60), NOW), true);
  assert.equal(isGoalStale(makeGoal("bhag", 59), NOW), false);

  // unknown level defaults to 14
  assert.equal(isGoalStale(makeGoal("unknown", 14), NOW), true);
  assert.equal(isGoalStale(makeGoal("unknown", 13), NOW), false);
});
