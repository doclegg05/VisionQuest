import test from "node:test";
import assert from "node:assert/strict";
import {
  trimRecentEvents,
  fieldsForViewer,
  type ProgressionEventSummary,
  type ContextViewer,
} from "./context-bundle";

function makeEvent(occurredAt: Date): ProgressionEventSummary {
  return {
    eventType: "test",
    sourceType: "test",
    xp: 0,
    occurredAt,
  };
}

test("trimRecentEvents: returns input untouched when under cap", () => {
  const events = [
    makeEvent(new Date("2026-04-29")),
    makeEvent(new Date("2026-04-28")),
  ];
  const result = trimRecentEvents(events, 5);
  assert.equal(result.kept.length, 2);
  assert.equal(result.dropped, 0);
});

test("trimRecentEvents: returns input untouched when exactly at cap", () => {
  const events = [
    makeEvent(new Date("2026-04-29")),
    makeEvent(new Date("2026-04-28")),
    makeEvent(new Date("2026-04-27")),
  ];
  const result = trimRecentEvents(events, 3);
  assert.equal(result.kept.length, 3);
  assert.equal(result.dropped, 0);
});

test("trimRecentEvents: trims and reports dropped count when over cap", () => {
  const events = Array.from({ length: 10 }, (_, i) =>
    makeEvent(new Date(2026, 3, 29 - i)),
  );
  const result = trimRecentEvents(events, 4);
  assert.equal(result.kept.length, 4);
  assert.equal(result.dropped, 6);
  // Order preserved (descending input → keeps the most recent four).
  assert.deepEqual(
    result.kept.map((e) => e.occurredAt.toISOString()),
    [
      new Date(2026, 3, 29).toISOString(),
      new Date(2026, 3, 28).toISOString(),
      new Date(2026, 3, 27).toISOString(),
      new Date(2026, 3, 26).toISOString(),
    ],
  );
});

test("fieldsForViewer: returns the same key set for every viewer in Tier A", () => {
  // Tier A bundle is shape-stable across viewers; RLS does the filtering
  // at the DB. This test pins the contract so a future viewer-tightening
  // (Tier B) shows up as a deliberate test break.
  const viewers: ContextViewer[] = ["self", "teacher", "sage"];
  const sets = viewers.map((v) => new Set(fieldsForViewer(v)));
  assert.deepEqual(
    [...sets[0]!].sort(),
    [...sets[1]!].sort(),
  );
  assert.deepEqual(
    [...sets[1]!].sort(),
    [...sets[2]!].sort(),
  );
  // Sanity: required keys present.
  for (const required of [
    "student",
    "goals",
    "certifications",
    "orientation",
    "recentEvents",
    "alerts",
    "insights",
    "conversationContext",
    "meta",
  ] as const) {
    assert.ok(sets[0]!.has(required), `expected viewer fields to include "${required}"`);
  }
});
