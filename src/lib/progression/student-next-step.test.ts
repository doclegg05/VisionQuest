import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createInitialState } from "./engine";
import {
  DISCOVERY_STALL_ASSISTANT_TURNS,
  nextStepShortLabel,
  resolveStudentNextStep,
  type StudentNextStepSignals,
} from "./student-next-step";

function makeSignals(
  overrides: Partial<StudentNextStepSignals> = {},
): StudentNextStepSignals {
  return {
    state: createInitialState(),
    orientationComplete: true,
    bhagCompleted: false,
    hasCompletedDiscovery: false,
    goalCount: 0,
    monthlyGoalCount: 0,
    completedMilestoneCount: 0,
    savedJobCount: 0,
    applicationCount: 0,
    openAlertCount: 0,
    openTaskCount: 0,
    sageProposedUnconfirmedGoalCount: 0,
    discoveryAssistantTurnCount: 0,
    ...overrides,
  };
}

function stepStatus(
  result: ReturnType<typeof resolveStudentNextStep>,
  key: string,
) {
  return result.steps.find((step) => step.key === key)?.status;
}

test("incomplete orientation is the current target before anything else", () => {
  const result = resolveStudentNextStep(makeSignals({ orientationComplete: false }));

  assert.equal(result.currentStepKey, "orientation");
  assert.equal(stepStatus(result, "orientation"), "active");
  assert.equal(stepStatus(result, "discover"), "locked");
  assert.equal(result.actionLink, "/orientation");
});

test("orientation stays the current target even when later progress exists", () => {
  const result = resolveStudentNextStep(
    makeSignals({
      orientationComplete: false,
      hasCompletedDiscovery: true,
      goalCount: 2,
    }),
  );

  assert.equal(result.currentStepKey, "orientation");
  // Later steps keep their data-driven statuses, matching how existing
  // goals already render as complete while discovery is still active.
  assert.equal(stepStatus(result, "discover"), "complete");
  assert.equal(stepStatus(result, "goal"), "complete");
});

test("orientation renders as a completed step 0 in the 8-step strip", () => {
  const result = resolveStudentNextStep(makeSignals());

  assert.equal(result.steps.length, 8);
  assert.equal(result.steps[0]?.key, "orientation");
  assert.equal(result.steps[0]?.status, "complete");
});

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

test("goals that are all unconfirmed Sage proposals surface coach confirmation as the current action", () => {
  const result = resolveStudentNextStep(
    makeSignals({
      hasCompletedDiscovery: true,
      goalCount: 2,
      sageProposedUnconfirmedGoalCount: 2,
    }),
  );

  assert.equal(result.currentStepKey, "goal");
  assert.equal(result.title, "Confirm this goal with your coach");
  assert.equal(result.actionLink, "/goals");
  assert.equal(stepStatus(result, "goal"), "active");
  // Phase gating is unchanged: learn stays unlocked, just not the current action.
  assert.equal(stepStatus(result, "learn"), "available");
});

test("a single confirmed or student-created goal keeps the normal learn progression", () => {
  const result = resolveStudentNextStep(
    makeSignals({
      hasCompletedDiscovery: true,
      goalCount: 2,
      sageProposedUnconfirmedGoalCount: 1,
    }),
  );

  assert.equal(result.currentStepKey, "learn");
  assert.equal(stepStatus(result, "goal"), "complete");
  assert.equal(stepStatus(result, "learn"), "active");
});

test("unconfirmed Sage proposals do not stall students who already show learning progress", () => {
  const result = resolveStudentNextStep(
    makeSignals({
      hasCompletedDiscovery: true,
      goalCount: 2,
      sageProposedUnconfirmedGoalCount: 2,
      completedMilestoneCount: 1,
    }),
  );

  assert.equal(result.currentStepKey, "prove");
  assert.equal(stepStatus(result, "goal"), "complete");
});

test("a long discovery conversation surfaces the coach-review nudge without changing the step", () => {
  const result = resolveStudentNextStep(
    makeSignals({
      discoveryAssistantTurnCount: DISCOVERY_STALL_ASSISTANT_TURNS,
    }),
  );

  assert.equal(result.currentStepKey, "discover");
  assert.equal(result.actionLink, "/chat");
  assert.match(result.description, /Ask your coach to review your discovery/);
});

test("a short discovery conversation does not show the coach-review nudge", () => {
  const result = resolveStudentNextStep(
    makeSignals({
      discoveryAssistantTurnCount: DISCOVERY_STALL_ASSISTANT_TURNS - 1,
    }),
  );

  assert.equal(result.currentStepKey, "discover");
  assert.doesNotMatch(result.description, /review your discovery/);
});

test("nextStepShortLabel names the current step from the same result", () => {
  const orientation = resolveStudentNextStep(makeSignals({ orientationComplete: false }));
  assert.equal(nextStepShortLabel(orientation), "Orientation");

  const learn = resolveStudentNextStep(
    makeSignals({ hasCompletedDiscovery: true, goalCount: 2 }),
  );
  assert.equal(learn.currentStepKey, "learn");
  assert.equal(nextStepShortLabel(learn), "Learn");
});

// Charter contract: the student journey has exactly ONE next-action engine.
// Dashboard support is shared by SSR and polling and renders the canonical
// result directly, never the retired DashboardClient heuristic.
test("dashboard renders StudentNextStepResult, not a second engine", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const dashboardSource = readFileSync(
    join(testDir, "../../app/(student)/dashboard/page.tsx"),
    "utf8",
  );

  assert.ok(
    !dashboardSource.includes("findNextGap"),
    "dashboard must not run an independent next-gap engine (findNextGap)",
  );
  const supportSource = readFileSync(join(testDir, "../dashboard/support.ts"), "utf8");
  const clientSource = readFileSync(join(testDir, "../../app/(student)/dashboard/DashboardClient.tsx"), "utf8");
  assert.ok(dashboardSource.includes("readSupport(session.id, readinessData)"));
  assert.ok(supportSource.includes("getStudentNextStep(studentId, readiness)"));
  assert.ok(clientSource.includes("<PathToEmployment {...support.data.nextStep}"));
  assert.ok(!clientSource.includes("findNextGap") && !clientSource.includes("const nextStep ="));
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
