/* eslint-disable @typescript-eslint/no-explicit-any -- the fake transaction records loosely typed Prisma args. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isHeldByTeacher, writeDetectedAlert, type DetectedAlert } from "./alert-hold";

const NOW = new Date("2026-10-15T10:35:00.000Z");

describe("isHeldByTeacher", () => {
  it("holds a dismissed alert", () => {
    assert.equal(isHeldByTeacher({ status: "dismissed", snoozedUntil: null }, NOW), true);
  });

  it("holds a snoozed alert until its snooze ends", () => {
    const later = new Date(NOW.getTime() + 60_000);
    assert.equal(isHeldByTeacher({ status: "snoozed", snoozedUntil: later }, NOW), true);
    assert.equal(isHeldByTeacher({ status: "snoozed", snoozedUntil: NOW }, NOW), false);
    assert.equal(isHeldByTeacher({ status: "snoozed", snoozedUntil: null }, NOW), false);
  });

  it("does not hold an open or resolved alert, or one that does not exist yet", () => {
    assert.equal(isHeldByTeacher({ status: "open", snoozedUntil: null }, NOW), false);
    assert.equal(isHeldByTeacher({ status: "resolved", snoozedUntil: null }, NOW), false);
    assert.equal(isHeldByTeacher(undefined, NOW), false);
  });
});

const ALERT: DetectedAlert = {
  studentId: "student-1",
  alertKey: "goal_stale:goal-1",
  type: "goal_stale",
  severity: "medium",
  title: "Goal needs a check-in",
  summary: "Monthly goal not reviewed in 15 days.",
  sourceType: "goal",
  sourceId: "goal-1",
};

function fakeTx() {
  const calls: { upsert: any[]; update: any[] } = { upsert: [], update: [] };
  const tx = {
    studentAlert: {
      upsert: async (args: unknown) => {
        calls.upsert.push(args);
      },
      update: async (args: unknown) => {
        calls.update.push(args);
      },
    },
  };
  return { tx: tx as never, calls };
}

// detectedAt is when the current spell of the alert began: queue ordering and
// the instructor resolution-time metric both read it. Reopening starts a new
// spell; rewriting an alert that is already open must not reset it.
describe("writeDetectedAlert detectedAt", () => {
  it("stamps a new alert with the detection time", async () => {
    const { tx, calls } = fakeTx();
    await writeDetectedAlert(tx, undefined, ALERT, NOW);
    assert.equal(calls.upsert[0].create.detectedAt, NOW);
  });

  it("restarts detectedAt when it reopens a resolved alert or an expired snooze", async () => {
    for (const prev of [
      { status: "resolved", snoozedUntil: null },
      { status: "snoozed", snoozedUntil: new Date(NOW.getTime() - 60_000) },
    ]) {
      const { tx, calls } = fakeTx();
      await writeDetectedAlert(tx, prev, ALERT, NOW);
      assert.equal(calls.upsert[0].update.detectedAt, NOW, `reopening a ${prev.status} alert`);
      assert.equal(calls.upsert[0].update.status, "open");
    }
  });

  it("keeps detectedAt on an alert that is already open", async () => {
    const { tx, calls } = fakeTx();
    await writeDetectedAlert(tx, { status: "open", snoozedUntil: null }, ALERT, NOW);
    assert.equal("detectedAt" in calls.upsert[0].update, false);
  });
});
