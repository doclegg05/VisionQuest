/* eslint-disable @typescript-eslint/no-explicit-any -- the fake alert store reads loosely typed Prisma args. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isHeldByTeacher, writeDetectedAlert, type AlertHoldState, type DetectedAlert } from "./alert-hold";

const NOW = new Date("2026-10-15T10:35:00.000Z");
const EARLIER = new Date("2026-10-01T09:00:00.000Z");

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

type Row = Record<string, any>;

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

// A one-table stand-in for the transaction: it applies each write to stored
// rows the way Postgres would, so tests assert on the alert a teacher would
// see rather than on the shape of the Prisma call.
function fakeAlertStore(initial?: Row) {
  const rows = new Map<string, Row>();
  if (initial) rows.set(initial.alertKey, { ...initial });
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => sameValue(row[k], v));
  const tx = {
    studentAlert: {
      upsert: async ({ where, create, update }: any) => {
        const row = rows.get(where.alertKey);
        rows.set(where.alertKey, row ? { ...row, ...update } : { ...create });
      },
      update: async ({ where, data }: any) => {
        const row = rows.get(where.alertKey);
        if (!row) throw new Error("No 'StudentAlert' record was found for an update.");
        rows.set(where.alertKey, { ...row, ...data });
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [key, row] of rows) {
          if (!matches(row, where)) continue;
          rows.set(key, { ...row, ...data });
          count++;
        }
        return { count };
      },
    },
  };
  return { tx: tx as never, row: () => rows.get(ALERT.alertKey) };
}

function storedAlert(state: AlertHoldState, over: Row = {}): Row {
  return { ...ALERT, title: "Old title", detectedAt: EARLIER, ...state, ...over };
}

// detectedAt is when the current spell of the alert began: queue ordering and
// the instructor resolution-time metric both read it. Reopening starts a new
// spell; rewriting an alert that is already open must not reset it.
describe("writeDetectedAlert detectedAt", () => {
  it("stamps a new alert with the detection time", async () => {
    const store = fakeAlertStore();
    await writeDetectedAlert(store.tx, undefined, ALERT, NOW);
    assert.equal(store.row()?.status, "open");
    assert.equal(store.row()?.detectedAt, NOW);
  });

  it("restarts detectedAt when it reopens a resolved alert or an expired snooze", async () => {
    for (const prev of [
      { status: "resolved", snoozedUntil: null },
      { status: "snoozed", snoozedUntil: new Date(NOW.getTime() - 60_000) },
    ]) {
      const store = fakeAlertStore(storedAlert(prev));
      await writeDetectedAlert(store.tx, prev, ALERT, NOW);
      assert.equal(store.row()?.status, "open", `reopening a ${prev.status} alert`);
      assert.equal(store.row()?.detectedAt, NOW, `reopening a ${prev.status} alert`);
      assert.equal(store.row()?.snoozedUntil, null);
    }
  });

  it("keeps detectedAt on an alert that is already open", async () => {
    const prev = { status: "open", snoozedUntil: null };
    const store = fakeAlertStore(storedAlert(prev));
    await writeDetectedAlert(store.tx, prev, ALERT, NOW);
    assert.equal(store.row()?.detectedAt, EARLIER);
    assert.equal(store.row()?.title, ALERT.title);
  });
});

describe("writeDetectedAlert and a teacher's hold", () => {
  it("refreshes only the text of an alert the teacher has dismissed", async () => {
    const prev = { status: "dismissed", snoozedUntil: null };
    const store = fakeAlertStore(storedAlert(prev));
    await writeDetectedAlert(store.tx, prev, ALERT, NOW);
    assert.equal(store.row()?.status, "dismissed");
    assert.equal(store.row()?.title, ALERT.title);
  });

  // PR #248 review (Greptile P1, "Teacher choices get overwritten"): the
  // detectors read every alert's state first, then write one by one. A
  // teacher's dismiss or snooze that commits between that read and this
  // write must survive it.
  it("keeps a teacher's dismiss that lands after the detector read the alert", async () => {
    const readByDetector = { status: "open", snoozedUntil: null };
    const store = fakeAlertStore(storedAlert({ status: "dismissed", snoozedUntil: null }));

    await writeDetectedAlert(store.tx, readByDetector, ALERT, NOW);

    assert.equal(store.row()?.status, "dismissed");
    assert.equal(store.row()?.title, ALERT.title);
  });

  it("keeps a teacher's snooze that lands after the detector read the alert", async () => {
    const until = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    const readByDetector = { status: "open", snoozedUntil: null };
    const store = fakeAlertStore(storedAlert({ status: "snoozed", snoozedUntil: until }, { snoozedBy: "teacher-1" }));

    await writeDetectedAlert(store.tx, readByDetector, ALERT, NOW);

    assert.equal(store.row()?.status, "snoozed");
    assert.equal(store.row()?.snoozedUntil, until);
    assert.equal(store.row()?.snoozedBy, "teacher-1");
  });
});
