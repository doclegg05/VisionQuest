/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
/**
 * PATCH /api/teacher/alerts/:id under two instructors (C10).
 *
 * The row lives in a small in-memory store whose `updateMany` applies its `where` the way Postgres re-checks an
 * UPDATE against the latest committed row, so "A acts, B acts, A undoes" runs against one shared alert.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

interface AlertRow {
  id: string;
  studentId: string;
  status: string;
  resolvedAt: Date | null;
  dismissedAt: Date | null;
  snoozedUntil: Date | null;
  snoozedBy: string | null;
}

const ALERT_ID = "ckalert0000000000000000a1";
let row: AlertRow;
let currentSession: Session | null = null;

function matches(where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

const fakeAlerts = {
  findUnique: mock.fn(async ({ where }: { where: { id: string } }) => (where.id === row.id ? { ...row } : null)),
  updateMany: mock.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<AlertRow> }) => {
    if (!matches(where)) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  }),
  update: mock.fn(async () => {
    throw new Error("the route must not write without checking the state it expects");
  }),
};
const mockAssertCanManage = mock.fn(async () => undefined) as any;
const mockAudit = mock.fn(async () => ({ audited: true })) as any;

mock.module("@/lib/auth", { namedExports: { getSession: async () => currentSession } });
mock.module("@/lib/classroom", { namedExports: { assertStaffCanManageStudent: mockAssertCanManage } });
mock.module("@/lib/db", { namedExports: { prisma: { studentAlert: fakeAlerts } } });
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: mockAudit } });

let route: Awaited<typeof import("./route")>;
before(async () => {
  route = await import("./route");
});

const A = { ...mockTeacherSession(), id: "teacher-a" };
const B = { ...mockTeacherSession(), id: "teacher-b" };

beforeEach(() => {
  row = {
    id: ALERT_ID,
    studentId: "student-1",
    status: "open",
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    snoozedBy: null,
  };
  for (const m of [fakeAlerts.findUnique, fakeAlerts.updateMany, fakeAlerts.update, mockAssertCanManage, mockAudit]) {
    m.mock.resetCalls();
  }
});

async function patch(as: Session, body: unknown, id = ALERT_ID): Promise<{ status: number; json: any }> {
  currentSession = as;
  const req = mockRequest(`/api/teacher/alerts/${id}`, { method: "PATCH", body });
  const res = await route.PATCH(req as any, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
}

function auditActions(): string[] {
  return mockAudit.mock.calls.map((call: any) => call.arguments[0].action);
}

describe("PATCH /api/teacher/alerts/:id, Undo against a newer decision", () => {
  it("undoes A's resolve when nothing changed since", async () => {
    const resolved = await patch(A, { action: "resolve" });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.json.status, "resolved");
    const at = resolved.json.resolvedAt;
    assert.equal(typeof at, "string");

    const undone = await patch(A, { action: "reopen", expected: { status: "resolved", at } });
    assert.equal(undone.status, 200);
    assert.equal(row.status, "open");
    assert.equal(row.resolvedAt, null);
  });

  it("refuses A's Undo after B dismissed the alert, and keeps B's decision", async () => {
    const resolved = await patch(A, { action: "resolve" });
    // B's list was loaded before A acted, then B reopened and dismissed it in their own window.
    row = { ...row, status: "open", resolvedAt: null };
    const dismissed = await patch(B, { action: "dismiss" });
    assert.equal(dismissed.status, 200);
    const before = { ...row };

    const undo = await patch(A, { action: "reopen", expected: { status: "resolved", at: resolved.json.resolvedAt } });
    assert.equal(undo.status, 409);
    assert.equal(undo.json.error, "Someone else changed this alert. The list now shows the latest.");
    assert.deepEqual(row, before);
  });

  it("refuses A's Undo after B resolved the alert again later", async () => {
    const first = await patch(A, { action: "resolve" });
    row = { ...row, status: "open", resolvedAt: null };
    await new Promise((resolve) => setTimeout(resolve, 5));
    await patch(B, { action: "resolve" });
    const before = { ...row };

    const undo = await patch(A, { action: "reopen", expected: { status: "resolved", at: first.json.resolvedAt } });
    assert.equal(undo.status, 409);
    assert.deepEqual(row, before);
  });

  it("refuses an Undo that does not say what it expects to undo", async () => {
    await patch(A, { action: "resolve" });
    const before = { ...row };
    const undo = await patch(A, { action: "reopen" });
    assert.equal(undo.status, 400);
    assert.deepEqual(row, before);
  });

  it("never writes with a bare update, so no path skips the expected-state check", async () => {
    const resolved = await patch(A, { action: "resolve" });
    await patch(A, { action: "reopen", expected: { status: "resolved", at: resolved.json.resolvedAt } });
    await patch(A, { action: "dismiss" });
    await patch(A, { action: "reopen", expected: { status: "dismissed", at: row.dismissedAt?.toISOString() } });
    await patch(A, { action: "snooze", hours: 2 });
    assert.equal(fakeAlerts.update.mock.callCount(), 0);
  });
});

describe("PATCH /api/teacher/alerts/:id, resolve, dismiss and snooze act only on an open alert", () => {
  it("refuses B's dismiss when A already snoozed it, and keeps A's snooze", async () => {
    await patch(A, { action: "snooze", hours: 24 });
    const before = { ...row };
    const dismissed = await patch(B, { action: "dismiss" });
    assert.equal(dismissed.status, 409);
    assert.deepEqual(row, before);
  });

  it("answers a second resolve of an already resolved alert as done, without writing", async () => {
    const first = await patch(A, { action: "resolve" });
    const before = { ...row };
    const second = await patch(B, { action: "resolve" });
    assert.equal(second.status, 200);
    assert.equal(second.json.status, "resolved");
    assert.equal(second.json.resolvedAt, first.json.resolvedAt);
    assert.deepEqual(row, before);
    assert.deepEqual(auditActions(), ["teacher.alert.resolved"]);
  });

  it("keeps the scope check before any write", async () => {
    mockAssertCanManage.mock.mockImplementationOnce(async () => {
      const { forbidden } = await import("@/lib/api-error");
      throw forbidden();
    });
    const res = await patch(A, { action: "dismiss" });
    assert.equal(res.status, 403);
    assert.equal(row.status, "open");
    assert.equal(fakeAlerts.updateMany.mock.callCount(), 0);
  });
});

describe("PATCH /api/teacher/alerts/:id, audit", () => {
  it("writes one audit row per transition with the actor and alert ids only", async () => {
    const resolved = await patch(A, { action: "resolve" });
    await patch(A, { action: "reopen", expected: { status: "resolved", at: resolved.json.resolvedAt } });
    await patch(B, { action: "dismiss" });
    await patch(B, { action: "reopen", expected: { status: "dismissed", at: row.dismissedAt?.toISOString() } });
    await patch(A, { action: "snooze", hours: 3 });

    assert.deepEqual(auditActions(), [
      "teacher.alert.resolved",
      "teacher.alert.reopened",
      "teacher.alert.dismissed",
      "teacher.alert.reopened",
      "teacher.alert.snoozed",
    ]);
    for (const call of mockAudit.mock.calls) {
      const input = call.arguments[0];
      assert.equal(input.targetType, "student_alert");
      assert.equal(input.targetId, ALERT_ID);
      assert.ok(input.actorId === "teacher-a" || input.actorId === "teacher-b");
      assert.doesNotMatch(JSON.stringify(input), /student-1/);
    }
  });

  it("records the status each transition moved the alert from", async () => {
    const resolved = await patch(A, { action: "resolve" });
    await patch(A, { action: "reopen", expected: { status: "resolved", at: resolved.json.resolvedAt } });
    assert.deepEqual(
      mockAudit.mock.calls.map((call: any) => call.arguments[0].metadata.from),
      ["open", "resolved"],
    );
  });

  it("refuses an id that is not a cuid before reading anything", async () => {
    const res = await patch(A, { action: "resolve" }, "not-an-id");
    assert.equal(res.status, 400);
    assert.equal(fakeAlerts.findUnique.mock.callCount(), 0);
  });

  it("writes no audit row for a refused Undo", async () => {
    await patch(A, { action: "resolve" });
    mockAudit.mock.resetCalls();
    await patch(A, { action: "reopen", expected: { status: "resolved", at: "2020-01-01T00:00:00.000Z" } });
    assert.equal(mockAudit.mock.callCount(), 0);
  });
});
