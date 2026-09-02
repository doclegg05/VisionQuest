/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { getRlsContext, type RlsContext } from "@/lib/rls-context";

// syncAlertsForStudents is the sessionless batch entrypoint used by the
// /api/internal/alerts/sync cron. The context loader is mocked so the test
// can prove each student's sync ran under that student's own RLS context
// (review F5/F62, 2026-09-01): under vq_app the StudentAlert upsert and the
// student's own nudge Notification are rejected with no context.
const seen: { studentId: string; ctx: RlsContext | undefined }[] = [];
let inFlight = 0;
let maxInFlight = 0;

const loadStudentAlertSyncContextMock = mock.fn() as any;
mock.module("@/lib/advising-sync-context", {
  namedExports: { loadStudentAlertSyncContext: loadStudentAlertSyncContextMock },
});
mock.module("@/lib/advising-sync", {
  namedExports: {
    buildStudentAlertSyncPlan: () => ({
      studentSignals: null,
      goalEvidenceEntries: [],
      goalReviewItems: [],
      desiredAlerts: [],
    }),
    applyStudentAlertSyncPlan: async () => undefined,
  },
});
mock.module("@/lib/advising-interventions", {
  namedExports: { syncInterventionNotifications: async () => undefined },
});
mock.module("@/lib/db", { namedExports: { prisma: {}, prismaAdmin: {} } });
mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() },
  },
});

let advising: typeof import("./advising");
before(async () => {
  advising = await import("./advising");
});

function studentContext(studentId: string): RlsContext {
  return { userId: studentId, role: "student", studentId };
}

describe("syncAlertsForStudents", () => {
  beforeEach(() => {
    seen.length = 0;
    inFlight = 0;
    maxInFlight = 0;
    loadStudentAlertSyncContextMock.mock.resetCalls();
    loadStudentAlertSyncContextMock.mock.mockImplementation(async (studentId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push({ studentId, ctx: getRlsContext() });
      inFlight -= 1;
      return { existing: [] };
    });
  });

  it("syncs each student inside that student's own RLS context", async () => {
    await advising.syncAlertsForStudents(["student-a", "student-b", "student-c"]);

    assert.deepEqual(
      seen.map((entry) => entry.ctx),
      [studentContext("student-a"), studentContext("student-b"), studentContext("student-c")],
    );
    assert.equal(getRlsContext(), undefined, "no context leaks out of the batch");
  });

  it("keeps the batch bound (at most batchSize students in flight)", async () => {
    await advising.syncAlertsForStudents(
      ["student-a", "student-b", "student-c", "student-d", "student-e", "student-f"],
      4,
    );

    assert.equal(loadStudentAlertSyncContextMock.mock.callCount(), 6);
    assert.ok(maxInFlight <= 4, `expected at most 4 in flight, saw ${maxInFlight}`);
    assert.ok(maxInFlight > 1, "batch still runs students concurrently");
  });
});
