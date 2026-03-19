import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GOAL_PLANNING_STATUSES,
  GOAL_STATUSES,
  goalCountsTowardPlan,
  goalStatusLabel,
  isGoalLevel,
  isGoalStatus,
} from "./goals";

describe("goal helpers", () => {
  it("accepts the supported goal levels", () => {
    assert.equal(isGoalLevel("bhag"), true);
    assert.equal(isGoalLevel("weekly"), true);
    assert.equal(isGoalLevel("unknown"), false);
  });

  it("accepts the supported goal statuses", () => {
    for (const status of GOAL_STATUSES) {
      assert.equal(isGoalStatus(status), true);
    }
    assert.equal(isGoalStatus("paused"), false);
  });

  it("flags only planning statuses as plan-bearing", () => {
    for (const status of GOAL_PLANNING_STATUSES) {
      assert.equal(goalCountsTowardPlan(status), true);
    }
    assert.equal(goalCountsTowardPlan("abandoned"), false);
  });

  it("returns a readable label for known statuses", () => {
    assert.equal(goalStatusLabel("in_progress"), "In Progress");
    assert.equal(goalStatusLabel("blocked"), "Blocked");
  });

  it("falls back to the raw value for unknown statuses", () => {
    assert.equal(goalStatusLabel("paused"), "paused");
  });
});
