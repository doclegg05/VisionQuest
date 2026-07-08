import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "./engine";
import {
  resolveStudentNextStep,
  type StudentNextStepSignals,
} from "./student-next-step";

function makeSignals(
  overrides: Partial<StudentNextStepSignals> = {},
): StudentNextStepSignals {
  return {
    state: createInitialState(),
    bhagCompleted: false,
    hasCompletedDiscovery: false,
    goalCount: 0,
    monthlyGoalCount: 0,
    completedMilestoneCount: 0,
    savedJobCount: 0,
    applicationCount: 0,
    openAlertCount: 0,
    openTaskCount: 0,
    ...overrides,
  };
}

function stepStatus(
  result: ReturnType<typeof resolveStudentNextStep>,
  key: string,
) {
  return result.steps.find((step) => step.key === key)?.status;
}

test("new students start with career discovery", () => {
  const result = resolveStudentNextStep(makeSignals());

  assert.equal(result.currentStepKey, "discover");
  assert.equal(stepStatus(result, "discover"), "active");
  assert.equal(stepStatus(result, "goal"), "locked");
  assert.equal(result.actionLink, "/chat");
});

test("students with completed discovery and no goals move to goal setting", () => {
  const result = resolveStudentNextStep(
    makeSignals({ hasCompletedDiscovery: true }),
  );

  assert.equal(result.currentStepKey, "goal");
  assert.equal(stepStatus(result, "discover"), "complete");
  assert.equal(stepStatus(result, "goal"), "active");
  assert.equal(result.actionLink, "/goals");
});

test("existing goals are preserved even when discovery is not complete", () => {
  const result = resolveStudentNextStep(
    makeSignals({ goalCount: 1, monthlyGoalCount: 1 }),
  );

  assert.equal(result.currentStepKey, "discover");
  assert.equal(stepStatus(result, "discover"), "active");
  assert.equal(stepStatus(result, "goal"), "complete");
});

test("students with goals but no learning proof move to learning", () => {
  const result = resolveStudentNextStep(
    makeSignals({ hasCompletedDiscovery: true, goalCount: 2 }),
  );

  assert.equal(result.currentStepKey, "learn");
  assert.equal(stepStatus(result, "goal"), "complete");
  assert.equal(stepStatus(result, "learn"), "active");
  assert.equal(result.actionLink, "/learning");
});

test("students with proof and resume move to job search", () => {
  const state = createInitialState();
  state.certificationsEarned = 1;
  state.portfolioItemCount = 1;
  state.resumeCreated = true;

  const result = resolveStudentNextStep(
    makeSignals({
      state,
      hasCompletedDiscovery: true,
      goalCount: 2,
      completedMilestoneCount: 1,
    }),
  );

  assert.equal(result.currentStepKey, "apply");
  assert.equal(stepStatus(result, "prepare"), "complete");
  assert.equal(stepStatus(result, "apply"), "active");
  assert.equal(result.actionLink, "/career");
});

test("open advising work blocks the follow-up step after applications start", () => {
  const state = createInitialState();
  state.certificationsEarned = 1;
  state.portfolioItemCount = 1;
  state.resumeCreated = true;

  const result = resolveStudentNextStep(
    makeSignals({
      state,
      hasCompletedDiscovery: true,
      goalCount: 2,
      completedMilestoneCount: 1,
      savedJobCount: 1,
      openTaskCount: 1,
    }),
  );

  assert.equal(result.currentStepKey, "followUp");
  assert.equal(stepStatus(result, "apply"), "complete");
  assert.equal(stepStatus(result, "followUp"), "blocked");
  assert.equal(result.actionLink, "/appointments");
});
