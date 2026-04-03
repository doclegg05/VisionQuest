import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeUrgencyScore,
  type StudentSignals,
} from "../intervention-scoring";

// ---------------------------------------------------------------------------
// Factory — fully active student with no issues (score should be 0)
// ---------------------------------------------------------------------------

function makeActiveStudent(overrides: Partial<StudentSignals> = {}): StudentSignals {
  return {
    daysSinceLastGoalReview: 3,
    daysSinceLastLogin: 1,
    orientationComplete: true,
    orientationProgress: 1.0,
    openAlertCount: 0,
    highSeverityAlertCount: 0,
    overdueTaskCount: 0,
    stalledGoalCount: 0,
    unmatchedGoalCount: 0,
    readinessScore: 80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeUrgencyScore", () => {
  it("returns 0 for a fully active student with no issues", () => {
    const score = computeUrgencyScore(makeActiveStudent());
    assert.equal(score, 0);
  });

  it("scores higher when goals are stale (21 days, 2 stalled goals)", () => {
    const baseline = computeUrgencyScore(makeActiveStudent());
    const stale = computeUrgencyScore(
      makeActiveStudent({
        daysSinceLastGoalReview: 21, // 7 days over 14 → +14
        stalledGoalCount: 2,         // 2 × 15 → +30
      }),
    );
    // Expected: 14 + 30 = 44
    assert.equal(stale, 44);
    assert.ok(stale > baseline);
  });

  it("scores higher with high-severity alerts", () => {
    const baseline = computeUrgencyScore(makeActiveStudent());
    const withAlerts = computeUrgencyScore(
      makeActiveStudent({
        highSeverityAlertCount: 2, // 2 × 20 → +40
        openAlertCount: 3,         // openAlertCount includes high-severity; non-high = 3 - 2 = 1 → +5
      }),
    );
    // Expected: 40 + 5 = 45
    assert.equal(withAlerts, 45);
    assert.ok(withAlerts > baseline);
  });

  it("scores higher when student hasn't logged in recently (14 days)", () => {
    const baseline = computeUrgencyScore(makeActiveStudent());
    const inactive = computeUrgencyScore(
      makeActiveStudent({
        daysSinceLastLogin: 14, // 14 - 7 = 7 days over threshold → 7 × 3 = +21
      }),
    );
    // Expected: 21
    assert.equal(inactive, 21);
    assert.ok(inactive > baseline);
  });

  it("scores higher with overdue tasks", () => {
    const baseline = computeUrgencyScore(makeActiveStudent());
    const overdue = computeUrgencyScore(
      makeActiveStudent({
        overdueTaskCount: 3, // 3 × 10 → +30
      }),
    );
    // Expected: 30
    assert.equal(overdue, 30);
    assert.ok(overdue > baseline);
  });

  it("scores higher with incomplete orientation", () => {
    const baseline = computeUrgencyScore(makeActiveStudent());
    const incomplete = computeUrgencyScore(
      makeActiveStudent({
        orientationComplete: false,
        orientationProgress: 0.4, // 25 × (1 - 0.4) = 25 × 0.6 = +15
      }),
    );
    // Expected: 15
    assert.equal(incomplete, 15);
    assert.ok(incomplete > baseline);
  });

  it("adds low-readiness penalty when readinessScore is below 40", () => {
    const score = computeUrgencyScore(
      makeActiveStudent({
        readinessScore: 20, // 30 - 20 × 0.5 = 30 - 10 = +20
      }),
    );
    // Expected: 20
    assert.equal(score, 20);
  });

  it("does not apply low-readiness penalty when readinessScore is 40 or above", () => {
    const score = computeUrgencyScore(makeActiveStudent({ readinessScore: 40 }));
    assert.equal(score, 0);
  });

  it("accumulates all signal contributions correctly", () => {
    const score = computeUrgencyScore({
      daysSinceLastGoalReview: 21,   // (21 - 14) × 2 = +14
      daysSinceLastLogin: 14,        // (14 - 7) × 3 = +21
      orientationComplete: false,
      orientationProgress: 0.0,      // 25 × (1 - 0) = +25
      openAlertCount: 5,             // non-high = 5 - 2 = 3 → 3 × 5 = +15
      highSeverityAlertCount: 2,     // 2 × 20 = +40
      overdueTaskCount: 2,           // 2 × 10 = +20
      stalledGoalCount: 1,           // 1 × 15 = +15
      unmatchedGoalCount: 1,         // 1 × 10 = +10
      readinessScore: 20,            // 30 - 20 × 0.5 = +20
    });
    // Expected: 14 + 21 + 25 + 15 + 40 + 20 + 15 + 10 + 20 = 180
    assert.equal(score, 180);
  });
});
