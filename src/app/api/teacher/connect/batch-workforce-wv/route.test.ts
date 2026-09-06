/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { READY_TO_WORK_SCORE } from "@/lib/connect/workforce-batch";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/**
 * POST /api/teacher/connect/batch-workforce-wv — the roster this program hands
 * to the WorkForce WV Business Services Rep (Match & Connect Task 3.4).
 *
 * This is the one route in Phase 3 that sends student data OUTSIDE the
 * program, so the assertions are about who gets in and what is recorded:
 * ready AND consented only, one named class only, POST only, rate-limited, and
 * audited over the exported rows rather than the roster that was considered.
 */

const session = mockTeacherSession();
let currentRole = "teacher";

const CLASS_ID = "clh0000000000000000000abc";

/** displayName, readiness score, consent — the three inputs that decide. */
let roster = [
  { id: "stu-ready", displayName: "Rivers Dana", score: 90, consented: true },
  { id: "stu-notready", displayName: "Ford Sam", score: READY_TO_WORK_SCORE - 1, consented: true },
  { id: "stu-noconsent", displayName: "Adams Kim", score: 95, consented: false },
];

const mockListConnectClasses = mock.fn(async () => [
  { id: CLASS_ID, name: "SPOKES Fall 2026" },
]) as any;
const mockEnrollmentFindMany = mock.fn(async () =>
  roster.map((student) => ({
    class: { name: "SPOKES Fall 2026" },
    student: {
      id: student.id,
      displayName: student.displayName,
      certifications: [{ certType: "ready-to-work" }],
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
let rateLimitOk = true;
const mockRateLimit = mock.fn(async () => ({
  success: rateLimitOk,
  remaining: 4,
  resetTime: Date.now() + 3_600_000,
  degraded: false,
})) as any;

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

mock.module("@/lib/rate-limit", {
  namedExports: {
    get rateLimit() {
      return mockRateLimit;
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
  rateLimitOk = true;
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
  mockEnrollmentFindMany.mock.resetCalls();
  mockRecordStudentView.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
  mockRateLimit.mock.resetCalls();
});

function post(body: unknown = { classId: CLASS_ID }) {
  return route.POST(
    mockRequest("/api/teacher/connect/batch-workforce-wv", { method: "POST", body }),
  );
}

describe("POST /api/teacher/connect/batch-workforce-wv", () => {
  it("refuses a student session before reading any roster", async () => {
    currentRole = "student";
    const response = await post();
    assert.equal(response.status, 403);
    assert.equal(mockListConnectClasses.mock.callCount(), 0);
  });

  it("requires a class — there is no program-wide export", async () => {
    const response = await post({});
    assert.equal(response.status, 400);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0);
  });

  it("refuses a class the caller does not manage", async () => {
    const response = await post({ classId: "clh0000000000000000000zzz" });
    assert.equal(response.status, 404);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0);
  });

  it("excludes a student who is not ready yet", async () => {
    const csv = await (await post()).text();
    assert.ok(!csv.includes("Ford Sam"), csv);
  });

  it("excludes a ready student who has not consented to being referred", async () => {
    const csv = await (await post()).text();
    assert.ok(
      !csv.includes("Adams Kim"),
      "no student data leaves the program without employer_referral consent",
    );
  });

  it("includes the student who is both ready and consented", async () => {
    const response = await post();
    assert.equal(response.status, 200);
    const lines = (await response.text()).trim().split("\r\n");
    assert.equal(lines.length, 2, "header plus exactly one student");
    assert.ok(lines[1].includes("Rivers Dana"), lines[1]);
  });

  it("orders rows by last name", async () => {
    roster = [
      { id: "a", displayName: "Dana Zephyr", score: 90, consented: true },
      { id: "b", displayName: "Sam Anders", score: 90, consented: true },
    ];
    const lines = (await (await post()).text()).trim().split("\r\n");
    assert.ok(lines[1].includes("Sam Anders"), lines[1]);
    assert.ok(lines[2].includes("Dana Zephyr"), lines[2]);
  });

  it("reads the roster in a deterministic order", async () => {
    // Without an ORDER BY, Postgres may return the enrollments in a different
    // sequence run to run. Two students whose last-name sort key ties would
    // then swap places between the preview a teacher confirms and the file
    // they download, and the dedupe could keep a different row for the same
    // person. Cheap to pin, invisible when it goes wrong.
    await post();
    assert.deepEqual(mockEnrollmentFindMany.mock.calls[0].arguments[0].orderBy, [
      { studentId: "asc" },
      { classId: "asc" },
    ]);
  });

  it("audits a staff read for the EXPORTED students only", async () => {
    await post();
    assert.equal(mockRecordStudentView.mock.callCount(), 1, "not the whole roster");
    const call = mockRecordStudentView.mock.calls[0].arguments[0];
    assert.equal(call.targetStudentId, "stu-ready");
    assert.equal(call.surface, "export");
  });

  it("records a count that equals the rows, plus why the others were left out", async () => {
    const response = await post();
    const rows = (await response.text()).trim().split("\r\n").length - 1;
    const entry = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(entry.action, "connect.workforce_batch.exported");
    assert.equal(entry.metadata.studentCount, rows);
    assert.equal(entry.metadata.excludedNotReady, 1);
    assert.equal(entry.metadata.excludedNoConsent, 1);
    assert.ok(!JSON.stringify(entry).includes("Rivers Dana"), "names belong in the file");
  });

  it("carries no benefits or barrier data out of the program", async () => {
    const csv = await (await post()).text();
    for (const forbidden of ["barrier", "TANF", "SNAP", "household", "birth"]) {
      assert.ok(!csv.toLowerCase().includes(forbidden.toLowerCase()), forbidden);
    }
  });

  it("returns a downloadable CSV named for today", async () => {
    const response = await post();
    assert.match(response.headers.get("content-type") ?? "", /text\/csv/u);
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /attachment; filename="connect-workforce-wv-\d{4}-\d{2}-\d{2}\.csv"/u,
    );
  });

  it("enforces a per-session rate limit", async () => {
    rateLimitOk = false;
    const response = await post();
    assert.equal(response.status, 429);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0, "a refused export is not a disclosure");
  });

  it("keys the rate limit on the session, not the network", async () => {
    await post();
    assert.match(mockRateLimit.mock.calls[0].arguments[0], new RegExp(session.id));
  });

  it("returns a header-only file, and audits nothing, when nobody qualifies", async () => {
    roster = [];
    const response = await post();
    const csv = await response.text();
    assert.equal(csv.trim().split("\r\n").length, 1);
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
  });
});

describe("GET /api/teacher/connect/batch-workforce-wv", () => {
  it("is 405 — a cross-site GET must not be able to trigger an export", async () => {
    const response = await route.GET();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });
});
