/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many Prisma call shapes */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Direct tests of the Prisma layer (dohs-export.ts), db mocked (W6 — code
// review). funnel.test.ts already covers connectManagedStudentIds /
// assertClassIsManaged in depth (SEC-W1) since both modules share them; this
// file focuses on what is DIFFERENT here: the SpokesRecord query shape, the
// full (not `take: 1`) employmentFollowUps + ConnectionEvent reads C1 needs,
// and the enrollment-status set used for the Class-name lookup (W9).

const mockStudentFindMany = mock.fn() as any;
const mockSpokesClassFindFirst = mock.fn() as any;
const mockSpokesRecordFindMany = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findMany: mockStudentFindMany },
      spokesClass: { findFirst: mockSpokesClassFindFirst },
      spokesRecord: { findMany: mockSpokesRecordFindMany },
    },
  },
});

let fetchDohsExport: typeof import("./dohs-export").fetchDohsExport;
let MAX_CONNECT_REPORT_ROWS: number;

before(async () => {
  ({ fetchDohsExport } = await import("./dohs-export"));
  ({ MAX_CONNECT_REPORT_ROWS } = await import("./classes"));
});

const teacherSession = { id: "teacher-1", role: "teacher" } as any;
const adminSession = { id: "admin-1", role: "admin" } as any;

function resetMocks() {
  mockStudentFindMany.mock.resetCalls();
  mockSpokesClassFindFirst.mock.resetCalls();
  mockSpokesRecordFindMany.mock.resetCalls();

  mockStudentFindMany.mock.mockImplementation(async () => []);
  mockSpokesClassFindFirst.mock.mockImplementation(async () => ({ id: "class-1" }));
  mockSpokesRecordFindMany.mock.mockImplementation(async () => []);
}

describe("fetchDohsExport — unmanaged-class refusal (W6)", () => {
  beforeEach(resetMocks);

  it("throws (404-shaped) and never queries students/records when assertClassIsManaged refuses the class", async () => {
    mockSpokesClassFindFirst.mock.mockImplementation(async () => null);
    await assert.rejects(
      () => fetchDohsExport(teacherSession, { classId: "not-mine" }),
      /wasn't found/,
    );
    assert.equal(mockStudentFindMany.mock.callCount(), 0);
    assert.equal(mockSpokesRecordFindMany.mock.callCount(), 0);
  });
});

describe("fetchDohsExport — instructor scoping (SEC-W1)", () => {
  beforeEach(resetMocks);

  it("a TEACHER's student query carries the instructor predicate", async () => {
    await fetchDohsExport(teacherSession, {});
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.deepEqual(args.where.classEnrollments.some.class, {
      instructors: { some: { instructorId: "teacher-1" } },
    });
  });

  it("an ADMIN's student query is program-wide with no instructor predicate", async () => {
    await fetchDohsExport(adminSession, {});
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.deepEqual(args.where, { role: "student" });
  });
});

describe("fetchDohsExport — SpokesRecord query shape (C1, W9, C2)", () => {
  beforeEach(resetMocks);

  it("selects ALL employment follow-ups (no `take: 1`) — C1's retention derivation needs every checkpoint", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, {});
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    assert.equal(args.select.employmentFollowUps.take, undefined);
    assert.deepEqual(args.select.employmentFollowUps.select, {
      checkpointMonths: true,
      status: true,
      checkedAt: true,
    });
  });

  it("selects the linked Connection's full event history (toStatus) for the retention fallback", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, {});
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    assert.deepEqual(
      args.select.placementApplication.select.connection.select.events,
      { select: { toStatus: true } },
    );
  });

  it("the Class-name lookup uses NON_ARCHIVED_ENROLLMENT_STATUSES, not 'active' alone (W9 — graduates)", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, {});
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    const statusFilter = args.select.student.select.classEnrollments.where.status.in;
    assert.ok(statusFilter.includes("completed"), "a graduate's 'completed' enrollment must still resolve a class name");
    assert.ok(statusFilter.includes("active"));
  });

  it("forwards employerId to the SpokesRecord query via placementApplication.connection (2026-09 second-pass 'Take')", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, { employerId: "employer-1" });
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    assert.deepEqual(args.where.placementApplication, {
      is: { connection: { is: { employerId: "employer-1" } } },
    });
  });

  it("omits the placementApplication filter entirely when no employerId is given", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, {});
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    assert.equal(args.where.placementApplication, undefined);
  });

  it("resolves date-only from/to to PLAIN UTC instants on SpokesRecord.enrolledAt (@db.Date — no ET conversion)", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, { from: "2026-06-01", to: "2026-06-30" });
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    // C1 regression guard: enrolledAt is a @db.Date column stored at exactly
    // UTC midnight for its calendar date. The ET-aware bound
    // (reportDateRangeBoundsUtc, 04:00Z) would exclude a row literally dated
    // 2026-06-01T00:00:00Z and admit one dated 2026-07-01T00:00:00Z — this
    // pins the correct plain-UTC bounds instead.
    assert.equal(args.where.enrolledAt.gte.toISOString(), "2026-06-01T00:00:00.000Z");
    assert.equal(args.where.enrolledAt.lt.toISOString(), "2026-07-01T00:00:00.000Z");
  });
});

describe("fetchDohsExport — bounded report reads (W12 partial)", () => {
  beforeEach(resetMocks);

  it("caps the SpokesRecord read at MAX_CONNECT_REPORT_ROWS", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchDohsExport(teacherSession, {});
    const [args] = mockSpokesRecordFindMany.mock.calls[0].arguments;
    assert.equal(args.take, 50_000);
    assert.equal(MAX_CONNECT_REPORT_ROWS, 50_000, "test literal and the exported constant must agree");
  });
});

describe("fetchDohsExport — zero managed students short-circuits", () => {
  beforeEach(resetMocks);

  it("returns an empty result without querying SpokesRecord at all", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => []);
    const result = await fetchDohsExport(teacherSession, {});
    assert.equal(mockSpokesRecordFindMany.mock.callCount(), 0);
    assert.deepEqual(result, { rows: [], studentIds: [] });
  });
});
