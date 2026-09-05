/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/**
 * GET /api/teacher/connect/batch-workforce-wv — the roster this program hands
 * to the WorkForce WV Business Services Rep (Match & Connect Task 3.4).
 *
 * This is the one route in Phase 3 that sends student data OUTSIDE the
 * program, so the assertions are about scope and traceability: it exports only
 * the caller's own students, it audits the export and each student read, and
 * the file it produces carries none of the SPOKES record's benefits or
 * barrier fields.
 */

const session = mockTeacherSession();
let currentRole = "teacher";

const mockListManagedStudentIds = mock.fn(async () => ["stu-1", "stu-2"]) as any;
const mockStudentFindMany = mock.fn(async () => [
  {
    id: "stu-1",
    displayName: "Dana Rivers",
    certifications: [{ certType: "ready-to-work" }],
    classEnrollments: [{ class: { name: "SPOKES Fall 2026" } }],
  },
  {
    id: "stu-2",
    displayName: "Sam Ford",
    certifications: [],
    classEnrollments: [],
  },
]) as any;
const mockWorkProfileFindMany = mock.fn(async () => []) as any;
const mockFetchReadiness = mock.fn(async () => ({ readiness: { score: 80 } })) as any;
const mockRecordStudentView = mock.fn(async () => {}) as any;
const mockLogAuditEvent = mock.fn(async () => {}) as any;

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
        return handler({ ...session, role: currentRole }, ...args);
      },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        get findMany() {
          return mockStudentFindMany;
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

mock.module("@/lib/classroom", {
  namedExports: {
    get listManagedStudentIds() {
      return mockListManagedStudentIds;
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
  mockListManagedStudentIds.mock.resetCalls();
  mockStudentFindMany.mock.resetCalls();
  mockRecordStudentView.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
});

describe("GET /api/teacher/connect/batch-workforce-wv", () => {
  it("refuses a student session before reading any roster", async () => {
    currentRole = "student";
    const response = await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    assert.equal(response.status, 403);
    assert.equal(mockListManagedStudentIds.mock.callCount(), 0);
  });

  it("scopes the export to the caller's own students", async () => {
    await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    assert.equal(mockListManagedStudentIds.mock.callCount(), 1);
    const args = mockStudentFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(args.where.id.in, ["stu-1", "stu-2"]);
  });

  it("returns a downloadable CSV named for today", async () => {
    const response = await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/csv/u);
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /attachment; filename="connect-workforce-wv-\d{4}-\d{2}-\d{2}\.csv"/u,
    );
  });

  it("carries a header and one row per student, and no benefits or barrier data", async () => {
    const response = await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    const csv = await response.text();
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 3, "header plus two students");
    assert.ok(lines[1].includes("Dana Rivers"), lines[1]);
    for (const forbidden of ["barrier", "TANF", "SNAP", "household", "birth"]) {
      assert.ok(
        !csv.toLowerCase().includes(forbidden.toLowerCase()),
        `"${forbidden}" must not appear in a file that leaves the program`,
      );
    }
  });

  it("audits a staff read for every student in the file", async () => {
    await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    assert.equal(mockRecordStudentView.mock.callCount(), 2);
    const first = mockRecordStudentView.mock.calls[0].arguments[0];
    assert.equal(first.actorId, session.id);
    assert.equal(first.surface, "export");
  });

  it("audits the export itself with a count, not a list of names", async () => {
    await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    const entry = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(entry.action, "connect.workforce_batch.exported");
    assert.equal(entry.metadata.studentCount, 2);
    assert.ok(!JSON.stringify(entry).includes("Dana Rivers"), JSON.stringify(entry));
  });

  it("returns a header-only file, and audits nothing, when the caller has no students", async () => {
    mockListManagedStudentIds.mock.mockImplementationOnce(async () => []);
    const response = await route.GET(mockRequest("/api/teacher/connect/batch-workforce-wv"));
    const csv = await response.text();
    assert.equal(csv.trim().split("\r\n").length, 1);
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });
});
