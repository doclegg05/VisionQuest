/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// Scheduled daily by pg_cron (migration 20261015120000_schedule_stall_detectors).
// It covers the students the alert sync never reaches: those who have stopped
// doing anything, so nothing triggers a sync for them.

const DAY_MS = 24 * 60 * 60 * 1000;

const goalFindMany = mock.fn() as any;
const alertFindMany = mock.fn() as any;
const alertUpsert = mock.fn() as any;
const alertUpdateMany = mock.fn() as any;
const transaction = mock.fn() as any;

const tx = {
  studentAlert: { findMany: alertFindMany, upsert: alertUpsert, updateMany: alertUpdateMany },
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
    alertUpdateMany.mock.mockImplementation(async () => ({ count: 1 }));
    transaction.mock.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  });

  afterEach(() => {
    for (const fn of [goalFindMany, alertFindMany, alertUpsert, alertUpdateMany, transaction]) {
      fn.mock.resetCalls();
    }
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("401s without the bearer secret", async () => {
    const res = await POST(request());
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
    assert.equal(alertUpsert.mock.callCount(), 1);
    const upsert = alertUpsert.mock.calls[0].arguments[0];
    assert.equal(upsert.where.alertKey, "goal_stale:goal-1");
    assert.deepEqual(upsert.create, {
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

  it("gives its transaction room for a program-wide run, past Prisma's 5 second default", async () => {
    await POST(request("Bearer test-cron-secret"));

    const options = transaction.mock.calls[0].arguments[1];
    assert.ok(options?.timeout >= 60_000, `transaction timeout was ${options?.timeout}`);
  });
});
