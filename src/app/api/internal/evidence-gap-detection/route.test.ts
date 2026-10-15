/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// Scheduled daily by pg_cron (migration 20261015120000_add_stall_detector_cron).
// The intervention queue's evidenceGapCount counts the alerts this writes.

const enrollmentFindMany = mock.fn() as any;
const requirementFindMany = mock.fn() as any;
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

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("POST /api/internal/evidence-gap-detection", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    enrollmentFindMany.mock.mockImplementation(async () => [
      { studentId: "student-1", classId: "class-1", enrolledAt: new Date("2026-10-10T00:00:00.000Z") },
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
    alertUpdateMany.mock.mockImplementation(async () => ({ count: 0 }));
    transaction.mock.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  });

  afterEach(() => {
    for (const fn of [enrollmentFindMany, requirementFindMany, alertFindMany, alertUpsert, alertUpdateMany, transaction]) {
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

  it("gives its transaction room for a program-wide run, past Prisma's 5 second default", async () => {
    await POST(request("Bearer test-cron-secret"));

    const options = transaction.mock.calls[0].arguments[1];
    assert.ok(options?.timeout >= 60_000, `transaction timeout was ${options?.timeout}`);
  });
});
