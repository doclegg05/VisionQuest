/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { getRlsContext, type RlsContext } from "@/lib/rls-context";

// The cron has no session. Roster reads span every class and every student,
// which no student's RLS branch can satisfy, so they stay on prismaAdmin;
// each student's readiness read must run as that student (review F5,
// 2026-09-01) or under vq_app it reads empty and the report says 0%.
const seen: { rosterCtx: (RlsContext | undefined)[]; readinessCtx: (RlsContext | undefined)[]; notifyCtx: (RlsContext | undefined)[] } = {
  rosterCtx: [],
  readinessCtx: [],
  notifyCtx: [],
};

const classFindManyMock = mock.fn() as any;
const instructorFindManyMock = mock.fn() as any;
const notificationCreateMock = mock.fn() as any;
mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      spokesClass: { findMany: classFindManyMock },
      spokesClassInstructor: { findMany: instructorFindManyMock },
      notification: { create: notificationCreateMock },
    },
  },
});

const fetchReadinessMock = mock.fn() as any;
mock.module("@/lib/progression/fetch-readiness-data", {
  namedExports: { fetchStudentReadinessData: fetchReadinessMock },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() },
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

function request(auth?: string): Request {
  return new Request("http://localhost:3000/api/internal/reports", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

function studentContext(studentId: string): RlsContext {
  return { userId: studentId, role: "student", studentId };
}

const SCORES: Record<string, number> = { "student-a": 80, "student-b": 40 };

describe("POST /api/internal/reports", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    seen.rosterCtx.length = 0;
    seen.readinessCtx.length = 0;
    seen.notifyCtx.length = 0;

    classFindManyMock.mock.resetCalls();
    instructorFindManyMock.mock.resetCalls();
    notificationCreateMock.mock.resetCalls();
    fetchReadinessMock.mock.resetCalls();

    classFindManyMock.mock.mockImplementation(async () => {
      seen.rosterCtx.push(getRlsContext());
      return [
        {
          id: "class-1",
          name: "Morning Cohort",
          enrollments: [
            { student: { id: "student-a", displayName: "A" } },
            { student: { id: "student-b", displayName: "B" } },
          ],
        },
      ];
    });
    instructorFindManyMock.mock.mockImplementation(async () => [{ instructorId: "teacher-1" }]);
    notificationCreateMock.mock.mockImplementation(async (args: unknown) => {
      seen.notifyCtx.push(getRlsContext());
      return args;
    });
    fetchReadinessMock.mock.mockImplementation(async (studentId: string) => {
      seen.readinessCtx.push(getRlsContext());
      return { readiness: { score: SCORES[studentId] ?? 0 } };
    });
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("401s without the bearer secret and touches nothing", async () => {
    const res = await route.POST(request());
    assert.equal(res.status, 401);
    assert.equal(classFindManyMock.mock.callCount(), 0);
  });

  it("reads each student's readiness as that student and the roster as admin", async () => {
    const res = await route.POST(request("Bearer test-cron-secret"));
    assert.equal(res.status, 200);

    assert.deepEqual(seen.readinessCtx, [studentContext("student-a"), studentContext("student-b")]);
    assert.deepEqual(seen.rosterCtx, [undefined], "cross-class roster read runs on the admin client, no student context");
    assert.deepEqual(seen.notifyCtx, [undefined], "teacher notification is an admin write, no student context");
    assert.equal(getRlsContext(), undefined, "no context leaks out of the loop");

    const body = (await res.json()) as { reports: { avgReadiness: number; readinessBuckets: Record<string, number> }[] };
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].avgReadiness, 60);
    assert.deepEqual(body.reports[0].readinessBuckets, { "0-25": 0, "26-50": 1, "51-75": 0, "76-100": 1 });

    assert.equal(notificationCreateMock.mock.callCount(), 1);
    const notification = notificationCreateMock.mock.calls[0].arguments[0].data;
    assert.equal(notification.studentId, "teacher-1");
    assert.equal(notification.type, "monthly_readiness_report");
  });

  it("skips a class with no active students", async () => {
    classFindManyMock.mock.mockImplementation(async () => [
      { id: "class-empty", name: "Empty", enrollments: [] },
    ]);
    const res = await route.POST(request("Bearer test-cron-secret"));
    const body = (await res.json()) as { reports: unknown[] };
    assert.deepEqual(body.reports, []);
    assert.equal(fetchReadinessMock.mock.callCount(), 0);
    assert.equal(notificationCreateMock.mock.callCount(), 0);
  });
});
