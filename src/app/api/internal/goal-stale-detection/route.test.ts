/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// Scheduled daily by pg_cron (migration 20261015120000_add_stall_detector_cron).
// It covers the students the alert sync never reaches: those who have stopped
// doing anything, so nothing triggers a sync for them.

const DAY_MS = 24 * 60 * 60 * 1000;

const goalFindMany = mock.fn() as any;
const alertFindMany = mock.fn() as any;
const alertUpsert = mock.fn() as any;
const alertUpdate = mock.fn() as any;
const alertUpdateMany = mock.fn() as any;
const transaction = mock.fn() as any;

const tx = {
  studentAlert: { findMany: alertFindMany, upsert: alertUpsert, update: alertUpdate, updateMany: alertUpdateMany },
};

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      goal: { findMany: goalFindMany },
      $transaction: transaction,
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() },
  },
});

let POST: (req: Request) => Promise<Response>;
before(async () => {
  ({ POST } = await import("./route"));
});

function request(auth?: string): Request {
  return new Request("http://localhost:3000/api/internal/goal-stale-detection", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

function daysAgo(days: number): Date {
  // Half a day of slack so a run that crosses midnight still floors to `days`.
  return new Date(Date.now() - days * DAY_MS - DAY_MS / 2);
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("POST /api/internal/goal-stale-detection", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    goalFindMany.mock.mockImplementation(async () => [
      {
        id: "goal-1",
        studentId: "student-1",
        level: "weekly",
        status: "active",
        updatedAt: daysAgo(2),
        lastReviewedAt: daysAgo(10),
      },
      {
        id: "goal-2",
        studentId: "student-1",
        level: "monthly",
        status: "active",
        updatedAt: daysAgo(3),
        lastReviewedAt: null,
      },
    ]);
    alertFindMany.mock.mockImplementation(async (args: any) =>
      args.where.alertKey
        ? []
        : [
            { id: "alert-fresh", sourceId: "goal-2" },
            { id: "alert-stale", sourceId: "goal-1" },
          ],
    );
    alertUpsert.mock.mockImplementation(async () => ({}));
    alertUpdate.mock.mockImplementation(async () => ({}));
    alertUpdateMany.mock.mockImplementation(async () => ({ count: 1 }));
    transaction.mock.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  });

  afterEach(() => {
    for (const fn of [goalFindMany, alertFindMany, alertUpsert, alertUpdate, alertUpdateMany, transaction]) {
      fn.mock.resetCalls();
    }
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("401s without the bearer secret", async () => {
    const res = await POST(request());
    assert.equal(res.status, 401);
    assert.equal(goalFindMany.mock.callCount(), 0);
  });

  it("401s a wrong bearer secret", async () => {
    const res = await POST(request("Bearer not-the-secret"));
    assert.equal(res.status, 401);
    assert.equal(goalFindMany.mock.callCount(), 0);
  });

  it("401s in development when CRON_SECRET is unset, like every other internal route", async () => {
    delete process.env.CRON_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const res = await POST(request());

    assert.equal(res.status, 401);
    assert.equal(goalFindMany.mock.callCount(), 0);
  });

  it("opens the same goal_stale alert the alert sync builds for that goal", async () => {
    const res = await POST(request("Bearer test-cron-secret"));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.scanned, 2);
    assert.equal(body.data.newAlerts, 1);
    assert.equal(alertUpsert.mock.callCount(), 1);
    const upsert = alertUpsert.mock.calls[0].arguments[0];
    assert.equal(upsert.where.alertKey, "goal_stale:goal-1");
    const { detectedAt, ...created } = upsert.create;
    assert.ok(detectedAt instanceof Date, "a new alert is stamped with its detection time");
    assert.deepEqual(created, {
      studentId: "student-1",
      alertKey: "goal_stale:goal-1",
      type: "goal_stale",
      severity: "medium",
      status: "open",
      title: "Weekly goal needs review",
      summary: "Weekly goal has not been reviewed in 10 days.",
      sourceType: "goal",
      sourceId: "goal-1",
    });
  });

  it("resolves open goal_stale alerts whose goals are no longer stale", async () => {
    await POST(request("Bearer test-cron-secret"));

    assert.equal(alertUpdateMany.mock.callCount(), 1);
    assert.deepEqual(alertUpdateMany.mock.calls[0].arguments[0].where, { id: { in: ["alert-fresh"] } });
  });

  it("scans only goals that are not completed, archived, cancelled or abandoned", async () => {
    await POST(request("Bearer test-cron-secret"));

    assert.deepEqual(goalFindMany.mock.calls[0].arguments[0].where, {
      status: { notIn: ["completed", "archived", "cancelled", "abandoned"] },
    });
  });

  // A teacher's dismiss means "won't reappear on resync" (PATCH
  // /api/teacher/alerts/:id), and the alert sync honors it and unexpired
  // snoozes (applyStudentAlertSyncPlan). A daily job must too.
  it("refreshes a dismissed alert's text but leaves it dismissed", async () => {
    alertFindMany.mock.mockImplementation(async (args: any) =>
      args.where.alertKey ? [{ alertKey: "goal_stale:goal-1", status: "dismissed", snoozedUntil: null }] : [],
    );

    await POST(request("Bearer test-cron-secret"));

    assert.equal(alertUpsert.mock.callCount(), 0);
    const { where, data } = alertUpdate.mock.calls[0].arguments[0];
    assert.equal(where.alertKey, "goal_stale:goal-1");
    assert.equal(data.summary, "Weekly goal has not been reviewed in 10 days.");
    assert.equal("status" in data, false);
  });

  it("leaves an alert snoozed until the snooze ends", async () => {
    alertFindMany.mock.mockImplementation(async (args: any) =>
      args.where.alertKey
        ? [{ alertKey: "goal_stale:goal-1", status: "snoozed", snoozedUntil: new Date(Date.now() + DAY_MS) }]
        : [],
    );

    await POST(request("Bearer test-cron-secret"));

    assert.equal(alertUpsert.mock.callCount(), 0);
    assert.equal("status" in alertUpdate.mock.calls[0].arguments[0].data, false);
  });

  it("reopens a resolved alert and clears its old resolution", async () => {
    alertFindMany.mock.mockImplementation(async (args: any) =>
      args.where.alertKey ? [{ alertKey: "goal_stale:goal-1", status: "resolved", snoozedUntil: null }] : [],
    );

    await POST(request("Bearer test-cron-secret"));

    // The reopen is a guarded updateMany keyed on the alert, not the
    // id-keyed updateMany that resolves alerts no longer found.
    const reopen = alertUpdateMany.mock.calls.find((call: any) => call.arguments[0].where.alertKey);
    assert.equal(reopen.arguments[0].where.status, "resolved");
    const update = reopen.arguments[0].data;
    assert.equal(update.status, "open");
    assert.equal(update.resolvedAt, null);
  });

  it("gives its transaction room for a program-wide run, past Prisma's 5 second default", async () => {
    await POST(request("Bearer test-cron-secret"));

    const options = transaction.mock.calls[0].arguments[1];
    assert.ok(options?.timeout >= 60_000, `transaction timeout was ${options?.timeout}`);
  });
});
