/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ALLOWED_COLUMNS, READY_TO_WORK_SCORE } from "@/lib/connect/workforce-batch";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/**
 * GET /api/teacher/connect/batch-workforce-wv/preview — what the instructor is
 * shown BEFORE the export runs (UX review CRITICAL #1, security review C1(d)).
 *
 * The console used to trigger the export from a bare link: one tap and a file
 * of TANF students' names was on disk and in the audit log, with nothing shown
 * first. The preview is what makes the confirm meaningful, so the assertions
 * are that it names the exact students and the exact fields the download will
 * contain — a preview that under-reports is worse than none — and that the
 * students it EXCLUDES are counted rather than named.
 *
 * The preview must NOT write an export audit event. Nothing has left the
 * program yet, and a ledger row claiming otherwise is a false record.
 */

const session = mockTeacherSession();
let currentRole = "teacher";

const CLASS_ID = "clh0000000000000000000abc";

let roster = [
  { id: "stu-ready", displayName: "Rivers Dana", score: 90, consented: true },
  { id: "stu-notready", displayName: "Ford Sam", score: READY_TO_WORK_SCORE - 1, consented: true },
  { id: "stu-noconsent", displayName: "Adams Kim", score: 95, consented: false },
];

let rateLimitOk = true;
const mockRateLimit = mock.fn(async () => ({
  success: rateLimitOk,
  remaining: 59,
  resetTime: Date.now() + 3_600_000,
  degraded: false,
})) as any;

const mockListConnectClasses = mock.fn(async () => [
  { id: CLASS_ID, name: "SPOKES Fall 2026" },
]) as any;
const mockEnrollmentFindMany = mock.fn(async () =>
  roster.map((student) => ({
    class: { name: "SPOKES Fall 2026" },
    student: {
      id: student.id,
      displayName: student.displayName,
      certifications: [],
    },
  })),
) as any;
const mockWorkProfileFindMany = mock.fn(async () => []) as any;
const mockFetchReadiness = mock.fn(async (studentId: string) => ({
  readiness: { score: roster.find((row) => row.id === studentId)?.score ?? 0 },
})) as any;
const mockHasActiveConsent = mock.fn(
  async (studentId: string) => roster.find((row) => row.id === studentId)?.consented ?? false,
) as any;
const mockRecordStudentView = mock.fn(async () => {}) as any;
const mockLogAuditEvent = mock.fn(async () => {}) as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        if (currentRole !== "teacher" && currentRole !== "admin") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        try {
          return await handler({ ...session, role: currentRole }, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    notFound: (message: string) => makeHttpError(404, message),
    rateLimited: (message: string) => makeHttpError(429, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: {
        get findMany() {
          return mockEnrollmentFindMany;
        },
      },
      studentWorkProfile: {
        get findMany() {
          return mockWorkProfileFindMany;
        },
      },
    },
  },
});

mock.module("@/lib/connect/classes", {
  namedExports: {
    // Kept real: selectBatchStudents reads it as a value, and a mocked module
    // replaces the WHOLE module, so omitting it makes the query throw.
    ENROLLED_STATUSES: ["active", "completed"],
    get listConnectClasses() {
      return mockListConnectClasses;
    },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    get rateLimit() {
      return mockRateLimit;
    },
  },
});

mock.module("@/lib/progression/fetch-readiness-data", {
  namedExports: {
    get fetchStudentReadinessData() {
      return mockFetchReadiness;
    },
  },
});

mock.module("@/lib/consent", {
  namedExports: {
    get hasActiveConsent() {
      return mockHasActiveConsent;
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    get recordStudentView() {
      return mockRecordStudentView;
    },
    get logAuditEvent() {
      return mockLogAuditEvent;
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  currentRole = "teacher";
  roster = [
    { id: "stu-ready", displayName: "Rivers Dana", score: 90, consented: true },
    {
      id: "stu-notready",
      displayName: "Ford Sam",
      score: READY_TO_WORK_SCORE - 1,
      consented: true,
    },
    { id: "stu-noconsent", displayName: "Adams Kim", score: 95, consented: false },
  ];
  mockListConnectClasses.mock.resetCalls();
  mockRateLimit.mock.resetCalls();
  rateLimitOk = true;
  mockEnrollmentFindMany.mock.resetCalls();
  mockRecordStudentView.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
});

function preview(classId: string | null = CLASS_ID) {
  return route.GET(
    mockRequest(
      "/api/teacher/connect/batch-workforce-wv/preview",
      classId ? { searchParams: { classId } } : {},
    ),
  );
}

describe("GET /api/teacher/connect/batch-workforce-wv/preview", () => {
  it("refuses a student session before reading any roster", async () => {
    currentRole = "student";
    const response = await preview();
    assert.equal(response.status, 403);
    assert.equal(mockListConnectClasses.mock.callCount(), 0);
  });

  it("requires a class", async () => {
    const response = await preview(null);
    assert.equal(response.status, 400);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0);
  });

  it("refuses a class the caller does not manage", async () => {
    const response = await preview("clh0000000000000000000zzz");
    assert.equal(response.status, 404);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0);
  });

  it("does not spend the rate-limit bucket on a class the caller cannot see", async () => {
    // Otherwise probing for other people's class ids would lock the caller out
    // of previewing their own.
    await preview("clh0000000000000000000zzz");
    assert.equal(mockRateLimit.mock.callCount(), 0);
  });

  it("refuses once the preview bucket is empty, before reading any roster", async () => {
    // A preview names a whole class and writes audit rows, so an unbounded
    // loop over class ids would enumerate the program without ever touching
    // the download's own ceiling.
    rateLimitOk = false;
    const response = await preview();
    assert.equal(response.status, 429);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0);
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
  });

  it("keys the preview limit on the session, not the network", async () => {
    // A classroom shares one IP; the thing being limited is one staff member.
    await preview();
    assert.match(mockRateLimit.mock.calls[0].arguments[0] as string, new RegExp(session.id));
  });

  it("returns the exact field allowlist the download will use", async () => {
    const body = await (await preview()).json();
    assert.deepEqual(
      body.fields,
      [...ALLOWED_COLUMNS],
      "the preview must list the download's real columns, in order — a stale copy would lie",
    );
  });

  it("names exactly the students the file will contain, and counts them", async () => {
    const body = await (await preview()).json();
    assert.equal(body.count, 1);
    assert.deepEqual(body.names, ["Rivers Dana"]);
  });

  it("counts the excluded by reason, and never names them", async () => {
    const response = await preview();
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(body.excludedNotReady, 1);
    assert.equal(body.excludedNoConsent, 1);
    assert.ok(!text.includes("Ford Sam"), text);
    assert.ok(
      !text.includes("Adams Kim"),
      "a student who has not consented to a referral has not consented to this screen either",
    );
  });

  it("names the class, so the confirm dialog says which roster this is", async () => {
    const body = await (await preview()).json();
    assert.equal(body.className, "SPOKES Fall 2026");
  });

  it("does NOT record an export — nothing has left the program yet", async () => {
    await preview();
    const actions = mockLogAuditEvent.mock.calls.map(
      (call: any) => call.arguments[0].action as string,
    );
    assert.ok(
      !actions.includes("connect.workforce_batch.exported"),
      `preview logged an export event: ${actions.join(", ")}`,
    );
  });

  it("still audits the staff read of the students it names", async () => {
    await preview();
    assert.equal(mockRecordStudentView.mock.callCount(), 1);
    const call = mockRecordStudentView.mock.calls[0].arguments[0];
    assert.equal(call.targetStudentId, "stu-ready");
    assert.equal(
      call.surface,
      "student_detail",
      "a preview is a read; the export surface belongs to the download",
    );
  });

  it("reports an empty week honestly rather than 404ing", async () => {
    roster = [];
    const response = await preview();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.count, 0);
    assert.deepEqual(body.names, []);
    assert.deepEqual(body.fields, [...ALLOWED_COLUMNS], "the columns are known even with no rows");
  });
});
