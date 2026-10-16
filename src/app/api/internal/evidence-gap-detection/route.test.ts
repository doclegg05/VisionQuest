/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// Scheduled daily by pg_cron (migration 20261015120000_add_stall_detector_cron).
// The intervention queue's evidenceGapCount counts the alerts this writes.

const enrollmentFindMany = mock.fn() as any;
const requirementFindMany = mock.fn() as any;
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
      studentClassEnrollment: { findMany: enrollmentFindMany },
      classRequirement: { findMany: requirementFindMany },
      certification: { findMany: async () => [] },
      orientationProgress: { findMany: async () => [] },
      formSubmission: { findMany: async () => [] },
      progression: { findMany: async () => [] },
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
  return new Request("http://localhost:3000/api/internal/evidence-gap-detection", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

const GAP_KEY = "evidence_gap:student-1:req-1";

/** The pre-read finds these rows by alertKey; the resolve pass finds `open`. */
function existingAlerts(byKey: object[], open: object[] = []) {
  alertFindMany.mock.mockImplementation(async (args: any) => (args.where.alertKey ? byKey : open));
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("POST /api/internal/evidence-gap-detection", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    enrollmentFindMany.mock.mockImplementation(async () => [
      { studentId: "student-1", classId: "class-1", enrolledAt: daysAgo(2) },
    ]);
    requirementFindMany.mock.mockImplementation(async () => [
      {
        id: "req-1",
        classId: "class-1",
        title: "Food Handler",
        itemType: "certification",
        itemId: "food-handler",
        status: "required",
      },
    ]);
    alertFindMany.mock.mockImplementation(async () => []);
    alertUpsert.mock.mockImplementation(async () => ({}));
    alertUpdate.mock.mockImplementation(async () => ({}));
    alertUpdateMany.mock.mockImplementation(async () => ({ count: 0 }));
    transaction.mock.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  });

  afterEach(() => {
    for (const fn of [enrollmentFindMany, requirementFindMany, alertFindMany, alertUpsert, alertUpdate, alertUpdateMany, transaction]) {
      fn.mock.resetCalls();
    }
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("401s without the bearer secret", async () => {
    const res = await POST(request());
    assert.equal(res.status, 401);
    assert.equal(enrollmentFindMany.mock.callCount(), 0);
  });

  it("401s a wrong bearer secret", async () => {
    const res = await POST(request("Bearer not-the-secret"));
    assert.equal(res.status, 401);
  });

  it("401s in development when CRON_SECRET is unset, like every other internal route", async () => {
    delete process.env.CRON_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const res = await POST(request());

    assert.equal(res.status, 401);
    assert.equal(enrollmentFindMany.mock.callCount(), 0);
  });

  it("opens an evidence_gap alert for each unmet required item", async () => {
    const res = await POST(request("Bearer test-cron-secret"));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.newAlerts, 1);
    assert.equal(alertUpsert.mock.callCount(), 1);
    const upsert = alertUpsert.mock.calls[0].arguments[0];
    assert.equal(upsert.where.alertKey, "evidence_gap:student-1:req-1");
    assert.equal(upsert.create.type, "evidence_gap");
    assert.equal(upsert.create.title, "Missing Certification: Food Handler");
  });

  // Every requirement-compliance reader scopes to active enrollments:
  // checkStudentCompliance and checkClassCompliance
  // (src/lib/class-requirement-compliance.ts), and so the sync's
  // requirement_noncompliant alert. The queue lists students with any
  // non-archived enrollment, but inactive, completed and withdrawn are states a
  // teacher set by hand, so a gap there is not news. Widening only this scan
  // would show a student two different requirement answers.
  it("scans active enrollments only, the scope every requirement-compliance reader uses", async () => {
    await POST(request("Bearer test-cron-secret"));

    assert.deepEqual(enrollmentFindMany.mock.calls[0].arguments[0].where, { status: "active" });
  });

  // The schema allows a student to be active in two classes. The sync's
  // requirement_noncompliant alert (checkStudentCompliance) answers for the
  // most recently enrolled one, so this scan must pick the same class, not
  // whichever row the database happens to return last.
  it("checks a student active in two classes against the most recent enrollment only", async () => {
    enrollmentFindMany.mock.mockImplementation(async () => [
      { studentId: "student-1", classId: "class-2", enrolledAt: daysAgo(2) },
      { studentId: "student-1", classId: "class-1", enrolledAt: daysAgo(20) },
    ]);
    requirementFindMany.mock.mockImplementation(async () => [
      { id: "req-1", classId: "class-1", title: "Food Handler", itemType: "certification", itemId: "food-handler", status: "required" },
      { id: "req-2", classId: "class-2", title: "Forklift", itemType: "certification", itemId: "forklift", status: "required" },
    ]);

    await POST(request("Bearer test-cron-secret"));

    const keys = alertUpsert.mock.calls.map((call: any) => call.arguments[0].where.alertKey);
    assert.deepEqual(keys, ["evidence_gap:student-1:req-2"]);
  });

  it("escalates a gap to high once the enrollment is 14 days old", async () => {
    enrollmentFindMany.mock.mockImplementation(async () => [
      { studentId: "student-1", classId: "class-1", enrolledAt: daysAgo(14) },
    ]);

    await POST(request("Bearer test-cron-secret"));

    assert.equal(alertUpsert.mock.calls[0].arguments[0].create.severity, "high");
  });

  it("raises no gap for an optional item", async () => {
    requirementFindMany.mock.mockImplementation(async () => [
      { id: "req-1", classId: "class-1", title: "Food Handler", itemType: "certification", itemId: "food-handler", status: "optional" },
    ]);

    const body = await (await POST(request("Bearer test-cron-secret"))).json();

    assert.equal(body.requirementsChecked, 0);
    assert.equal(alertUpsert.mock.callCount(), 0);
  });

  it("resolves open gaps whose item is now met", async () => {
    existingAlerts([], [
      { id: "alert-still-open", alertKey: GAP_KEY },
      { id: "alert-now-met", alertKey: "evidence_gap:student-1:req-done" },
    ]);

    const body = await (await POST(request("Bearer test-cron-secret"))).json();

    assert.equal(body.resolvedAlerts, 1);
    assert.deepEqual(alertUpdateMany.mock.calls[0].arguments[0].where, { id: { in: ["alert-now-met"] } });
  });

  // A teacher's dismiss means "won't reappear on resync" (PATCH
  // /api/teacher/alerts/:id), and the alert sync honors it and unexpired
  // snoozes (applyStudentAlertSyncPlan). A daily job must too.
  it("refreshes a dismissed gap's text but leaves it dismissed", async () => {
    existingAlerts([{ alertKey: GAP_KEY, status: "dismissed", snoozedUntil: null }]);

    await POST(request("Bearer test-cron-secret"));

    assert.equal(alertUpsert.mock.callCount(), 0);
    const { where, data } = alertUpdate.mock.calls[0].arguments[0];
    assert.equal(where.alertKey, GAP_KEY);
    assert.equal(data.title, "Missing Certification: Food Handler");
    assert.equal("status" in data, false);
  });

  it("leaves a gap snoozed until the snooze ends", async () => {
    existingAlerts([{ alertKey: GAP_KEY, status: "snoozed", snoozedUntil: new Date(Date.now() + DAY_MS) }]);

    await POST(request("Bearer test-cron-secret"));

    assert.equal(alertUpsert.mock.callCount(), 0);
    assert.equal("status" in alertUpdate.mock.calls[0].arguments[0].data, false);
  });

  it("reopens a gap whose snooze has ended, clearing the snooze and any old resolution", async () => {
    existingAlerts([{ alertKey: GAP_KEY, status: "snoozed", snoozedUntil: daysAgo(1) }]);

    await POST(request("Bearer test-cron-secret"));

    const { update } = alertUpsert.mock.calls[0].arguments[0];
    assert.equal(update.status, "open");
    assert.equal(update.snoozedUntil, null);
    assert.equal(update.snoozedBy, null);
    assert.equal(update.resolvedAt, null);
  });

  it("gives its transaction room for a program-wide run, past Prisma's 5 second default", async () => {
    await POST(request("Bearer test-cron-secret"));

    const options = transaction.mock.calls[0].arguments[1];
    assert.ok(options?.timeout >= 60_000, `transaction timeout was ${options?.timeout}`);
  });
});
