import assert from "node:assert/strict";
import test from "node:test";
import {
  WELCOME_COMPLETE_EVENT,
  WELCOME_PATHS,
  shouldEnterWelcome,
  shouldLeaveWelcome,
  type WelcomeRoutingFacts,
} from "./welcome-routing";

function facts(overrides: Partial<WelcomeRoutingFacts> = {}): WelcomeRoutingFacts {
  return {
    welcomeCompletedAt: null,
    goalCount: 0,
    conversationCount: 0,
    orientationCompletedCount: 0,
    ...overrides,
  };
}

// ── /dashboard → /welcome: who is genuinely day-1 ────────────────────────

test("a true day-1 student is routed to the welcome flow", () => {
  assert.equal(shouldEnterWelcome(facts()), true);
});

test("a student who finished the welcome flow is never routed back to it", () => {
  assert.equal(
    shouldEnterWelcome(facts({ welcomeCompletedAt: new Date("2026-08-20T12:00:00Z") })),
    false,
  );
});

test("choosing a path from welcome ends the loop even with no other activity", () => {
  // Path choice 2 (orientation) and 3 (dashboard) leave a student with zero
  // goals, zero conversations and — if they skipped the quick wins — zero
  // orientation progress. Only the recorded completion fact saves them from
  // being bounced straight back to /welcome.
  const chosePath = facts({ welcomeCompletedAt: new Date() });
  assert.equal(shouldEnterWelcome(chosePath), false);
});

test("orientation progress alone counts as started, so the dashboard stops bouncing", () => {
  assert.equal(shouldEnterWelcome(facts({ orientationCompletedCount: 1 })), false);
});

test("goals or conversations still count as started", () => {
  assert.equal(shouldEnterWelcome(facts({ goalCount: 1 })), false);
  assert.equal(shouldEnterWelcome(facts({ conversationCount: 1 })), false);
});

// ── /welcome → /dashboard: who has outgrown the flow ─────────────────────

test("a day-1 student is left alone in the welcome flow", () => {
  assert.equal(shouldLeaveWelcome(facts()), false);
});

test("a completed welcome flow is not shown twice", () => {
  assert.equal(shouldLeaveWelcome(facts({ welcomeCompletedAt: new Date() })), true);
});

test("an established student who opens /welcome is sent home", () => {
  assert.equal(shouldLeaveWelcome(facts({ goalCount: 1 })), true);
  assert.equal(shouldLeaveWelcome(facts({ conversationCount: 1 })), true);
});

test("a quick win completed INSIDE the flow never evicts the student from it", () => {
  // The regression that made the flow self-destruct: step 2 writes real
  // OrientationProgress rows, so orientation progress must not be a
  // leave-the-flow signal even though it IS a started signal for /dashboard.
  assert.equal(shouldLeaveWelcome(facts({ orientationCompletedCount: 3 })), false);
});

// ── the recorded fact ────────────────────────────────────────────────────

test("the completion fact is written exactly once per student", () => {
  // sourceId is part of ProgressionEvent's unique key, so a constant sourceId
  // makes a second path click a no-op instead of a second row.
  assert.equal(WELCOME_COMPLETE_EVENT.eventType, "welcome_complete");
  assert.equal(WELCOME_COMPLETE_EVENT.sourceType, "welcome");
  assert.equal(WELCOME_COMPLETE_EVENT.sourceId, "welcome-flow");
  assert.equal(WELCOME_COMPLETE_EVENT.xp, 0);
});

test("the path vocabulary is the three doors the last welcome step offers", () => {
  assert.deepEqual([...WELCOME_PATHS], ["chat", "orientation", "dashboard"]);
});
