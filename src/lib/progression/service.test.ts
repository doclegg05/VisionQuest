import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialState,
  parseState,
  recordChatSession,
  recordGoalSet,
  recordDailyCheckin,
} from "./engine";

// These tests validate the progression engine functions that the service layer
// delegates to. The service itself (updateProgression) requires a database
// connection, so we test the pure logic here.

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test("createInitialState returns level 1 with 0 XP", () => {
  const state = createInitialState();
  assert.equal(state.level, 1);
  assert.equal(state.xp, 0);
  assert.deepEqual(state.achievements, []);
  assert.deepEqual(state.completedGoalLevels, []);
});

// ---------------------------------------------------------------------------
// parseState — resilience
// ---------------------------------------------------------------------------

test("parseState returns initial state for null input", () => {
  const state = parseState(null);
  assert.equal(state.level, 1);
  assert.equal(state.xp, 0);
});

test("parseState returns initial state for invalid JSON", () => {
  const state = parseState("{not valid json");
  assert.equal(state.level, 1);
});

test("parseState clamps level to 1-5 range", () => {
  const state = parseState(JSON.stringify({ level: 99, xp: 0 }));
  assert.equal(state.level, 5);

  const low = parseState(JSON.stringify({ level: -1, xp: 0 }));
  assert.equal(low.level, 1);
});

test("parseState clamps xp to non-negative", () => {
  const state = parseState(JSON.stringify({ xp: -100 }));
  assert.equal(state.xp, 0);
});

// ---------------------------------------------------------------------------
// recordChatSession
// ---------------------------------------------------------------------------

test("recordChatSession awards 10 XP", () => {
  const state = createInitialState();
  const result = recordChatSession(state);
  assert.equal(result.xpGained, 10);
  assert.equal(state.xp, 10);
});

test("recordChatSession adds chat_session achievement", () => {
  const state = createInitialState();
  recordChatSession(state);
  assert.ok(state.achievements.includes("xp:chat_session"));
});

// ---------------------------------------------------------------------------
// recordGoalSet
// ---------------------------------------------------------------------------

test("recordGoalSet awards 50 XP for first goal at a level", () => {
  const state = createInitialState();
  const result = recordGoalSet(state, "bhag");
  assert.equal(result.xpGained, 50);
  assert.ok(state.completedGoalLevels.includes("bhag"));
});

test("recordGoalSet does not double-award for same level", () => {
  const state = createInitialState();
  recordGoalSet(state, "bhag");
  const result = recordGoalSet(state, "bhag");
  assert.equal(result.xpGained, 0);
  assert.equal(state.xp, 50); // only 50, not 100
});

test("recordGoalSet adds achievement for the goal level", () => {
  const state = createInitialState();
  recordGoalSet(state, "weekly");
  assert.ok(state.achievements.includes("xp:weekly_set"));
});

test("recordGoalSet advances level based on goal hierarchy", () => {
  const state = createInitialState();
  recordGoalSet(state, "bhag");
  assert.equal(state.level, 2);

  recordGoalSet(state, "monthly");
  assert.equal(state.level, 2);

  recordGoalSet(state, "weekly");
  assert.equal(state.level, 3);
});

// ---------------------------------------------------------------------------
// recordDailyCheckin
// ---------------------------------------------------------------------------

test("recordDailyCheckin awards 15 XP", () => {
  const state = createInitialState();
  const result = recordDailyCheckin(state);
  assert.equal(result.xpGained, 15);
  assert.equal(state.dailyCheckinsCount, 1);
});

test("recordDailyCheckin does not double-award same day", () => {
  const state = createInitialState();
  recordDailyCheckin(state);
  const result = recordDailyCheckin(state);
  assert.equal(result.xpGained, 0);
  assert.equal(state.dailyCheckinsCount, 1);
});

// ---------------------------------------------------------------------------
// Optimistic locking contract
// ---------------------------------------------------------------------------

test("updateProgression signature exists in service module", async () => {
  // Dynamic import to verify the service module exports correctly
  const service = await import("./service");
  assert.equal(typeof service.updateProgression, "function");
  assert.equal(typeof service.getProgression, "function");
});
