import assert from "node:assert/strict";
import test from "node:test";
import { computeReadinessScore } from "../progression/readiness-score";
import { buildReadinessSnapshot } from "../teacher/readiness-snapshot";

test("buildReadinessSnapshot reconciles DB-backed progress with stale progression state", () => {
  const snapshot = buildReadinessSnapshot({
    progressionState: JSON.stringify({
      completedGoalLevels: ["weekly"],
      longestStreak: 8,
      certificationsEarned: 1,
      portfolioItemCount: 1,
      resumeCreated: false,
      portfolioShared: false,
      orientationComplete: false,
    }),
    orientationCompletedCount: 4,
    orientationTotalCount: 4,
    bhagCompleted: true,
    certificationsEarned: 3,
    portfolioItemCount: 5,
    hasResume: true,
    portfolioShared: true,
    totalCertifications: 10,
  });

  assert.equal(snapshot.orientationProgress.completed, 4);
  assert.equal(snapshot.orientationProgress.total, 4);
  assert.equal(snapshot.state.orientationComplete, true);
  assert.equal(snapshot.state.resumeCreated, true);
  assert.equal(snapshot.state.portfolioShared, true);
  assert.equal(snapshot.state.certificationsEarned, 3);
  assert.equal(snapshot.state.portfolioItemCount, 5);
  assert.equal(snapshot.state.bhagCompleted, true);

  const expected = computeReadinessScore(
    {
      orientationComplete: true,
      orientationProgress: { completed: 4, total: 4 },
      completedGoalLevels: ["weekly"],
      bhagCompleted: true,
      certificationsEarned: 3,
      portfolioItemCount: 5,
      resumeCreated: true,
      portfolioShared: true,
      longestStreak: 8,
    },
    10,
  );

  assert.equal(snapshot.readiness.score, expected.score);
  assert.deepEqual(snapshot.readiness.breakdown, expected.breakdown);
});

test("buildReadinessSnapshot preserves higher progression counts when DB counts lag", () => {
  const snapshot = buildReadinessSnapshot({
    progressionState: JSON.stringify({
      completedGoalLevels: ["bhag", "monthly", "weekly"],
      longestStreak: 14,
      certificationsEarned: 4,
      portfolioItemCount: 3,
      resumeCreated: true,
      portfolioShared: false,
      orientationComplete: false,
    }),
    orientationCompletedCount: 1,
    orientationTotalCount: 4,
    bhagCompleted: false,
    certificationsEarned: 1,
    portfolioItemCount: 1,
    hasResume: false,
    portfolioShared: false,
  });

  assert.equal(snapshot.state.certificationsEarned, 4);
  assert.equal(snapshot.state.portfolioItemCount, 3);
  assert.equal(snapshot.state.resumeCreated, true);
  assert.equal(snapshot.state.orientationComplete, false);

  const expected = computeReadinessScore({
    orientationComplete: false,
    orientationProgress: { completed: 1, total: 4 },
    completedGoalLevels: ["bhag", "monthly", "weekly"],
    bhagCompleted: false,
    certificationsEarned: 4,
    portfolioItemCount: 3,
    resumeCreated: true,
    portfolioShared: false,
    longestStreak: 14,
  });

  assert.equal(snapshot.readiness.score, expected.score);
});
