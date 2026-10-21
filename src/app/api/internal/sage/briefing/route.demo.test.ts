import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// Cohort demo mode: the morning briefing is one paid AI job per student. Demo
// students are made up and numerous, so the sweep must not pick them up. The
// fake table below applies the `where` the route sends, so a sweep that
// forgets the filter enqueues a job for a demo student and the test sees it.

type FakeStudent = { id: string; role: string; isActive: boolean; demoAccount: string | null };

const TABLE: FakeStudent[] = [
  { id: "real-1", role: "student", isActive: true, demoAccount: null },
  { id: "demo-1", role: "student", isActive: true, demoAccount: "student" },
  { id: "real-2", role: "student", isActive: true, demoAccount: null },
  { id: "demo-2", role: "student", isActive: true, demoAccount: "student" },
];

const findManyMock = mock.fn(async (args: { where: Record<string, unknown> }) =>
  TABLE.filter((row) =>
    Object.entries(args.where).every(
      ([key, wanted]) => row[key as keyof FakeStudent] === wanted,
    ),
  ).map(({ id }) => ({ id })),
);
mock.module("@/lib/db", {
  exports: { prismaAdmin: { student: { findMany: findManyMock } } },
});

const enqueueJobMock = mock.fn<(...args: unknown[]) => Promise<string | null>>(
  async () => "job-1",
);
mock.module("@/lib/jobs", { exports: { enqueueJob: enqueueJobMock } });

mock.module("@/lib/sage/briefing", {
  exports: {
    isAutopilotEnabled: () => true,
    utcPanelDate: () => new Date(Date.UTC(2026, 9, 19)),
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

describe("POST /api/internal/sage/briefing and demo students", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    findManyMock.mock.resetCalls();
    enqueueJobMock.mock.resetCalls();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("asks only for students with no demo marker", async () => {
    await route.POST(
      new Request("http://localhost:3000/api/internal/sage/briefing", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    const where = findManyMock.mock.calls[0].arguments[0].where;
    assert.equal(where.demoAccount, null);
    assert.equal(where.role, "student", "the existing filters stay");
    assert.equal(where.isActive, true);
  });

  it("enqueues a briefing for each real student and none for a demo student", async () => {
    const res = await route.POST(
      new Request("http://localhost:3000/api/internal/sage/briefing", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    const body = (await res.json()) as { data: { enqueued: number; total: number } };

    assert.equal(body.data.total, 2);
    assert.equal(body.data.enqueued, 2);
    const studentIds = enqueueJobMock.mock.calls.map(
      (call) => (call.arguments[0] as { payload: { studentId: string } }).payload.studentId,
    );
    assert.deepEqual(studentIds, ["real-1", "real-2"]);
  });
});
