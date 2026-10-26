/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many Prisma call shapes */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Direct tests of the Prisma layer (funnel.ts), db mocked (W6 — code
// review). Two things a route-level mock of `fetchConnectFunnel` can never
// exercise: the ACTUAL where-clause `connectManagedStudentIds` and
// `assertClassIsManaged` build against `@/lib/db` (SEC-W1's instructor
// predicate), and the exact bounds `reportDateRangeBoundsUtc` produces
// (C2/W12).

const mockStudentFindMany = mock.fn() as any;
const mockSpokesClassFindFirst = mock.fn() as any;
const mockConnectionFindMany = mock.fn() as any;
const mockConnectionEventFindMany = mock.fn() as any;
const mockApplicationFindMany = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findMany: mockStudentFindMany },
      spokesClass: { findFirst: mockSpokesClassFindFirst },
      connection: { findMany: mockConnectionFindMany },
      connectionEvent: { findMany: mockConnectionEventFindMany },
      application: { findMany: mockApplicationFindMany },
    },
  },
});

let fetchConnectFunnel: typeof import("./funnel").fetchConnectFunnel;
let MAX_CONNECT_REPORT_ROWS: number;

before(async () => {
  ({ fetchConnectFunnel } = await import("./funnel"));
  ({ MAX_CONNECT_REPORT_ROWS } = await import("./classes"));
});

const teacherSession = { id: "teacher-1", role: "teacher" } as any;
const adminSession = { id: "admin-1", role: "admin" } as any;

function resetMocks() {
  mockStudentFindMany.mock.resetCalls();
  mockSpokesClassFindFirst.mock.resetCalls();
  mockConnectionFindMany.mock.resetCalls();
  mockConnectionEventFindMany.mock.resetCalls();
  mockApplicationFindMany.mock.resetCalls();

  mockStudentFindMany.mock.mockImplementation(async () => []);
  mockSpokesClassFindFirst.mock.mockImplementation(async () => ({ id: "class-1" }));
  mockConnectionFindMany.mock.mockImplementation(async () => []);
  mockConnectionEventFindMany.mock.mockImplementation(async () => []);
  mockApplicationFindMany.mock.mockImplementation(async () => []);
}

describe("fetchConnectFunnel — unmanaged-class refusal (W6)", () => {
  beforeEach(resetMocks);

  it("throws (404-shaped) and never queries students/connections when assertClassIsManaged refuses the class", async () => {
    mockSpokesClassFindFirst.mock.mockImplementation(async () => null);
    await assert.rejects(
      () => fetchConnectFunnel(teacherSession, { classId: "not-mine" }),
      /wasn't found/,
    );
    assert.equal(mockStudentFindMany.mock.callCount(), 0);
    assert.equal(mockConnectionFindMany.mock.callCount(), 0);
  });

  it("checks spokesClass with the instructor predicate for a teacher", async () => {
    mockSpokesClassFindFirst.mock.mockImplementation(async () => null);
    await assert.rejects(() => fetchConnectFunnel(teacherSession, { classId: "class-1" }));
    const [args] = mockSpokesClassFindFirst.mock.calls[0].arguments;
    assert.deepEqual(args.where.instructors, { some: { instructorId: "teacher-1" } });
  });

  it("admin's spokesClass check carries no instructor predicate", async () => {
    mockSpokesClassFindFirst.mock.mockImplementation(async () => null);
    await assert.rejects(() => fetchConnectFunnel(adminSession, { classId: "class-1" }));
    const [args] = mockSpokesClassFindFirst.mock.calls[0].arguments;
    assert.equal(args.where.instructors, undefined);
  });
});

describe("fetchConnectFunnel — instructor scoping without classId (SEC-W1)", () => {
  beforeEach(resetMocks);

  it("a TEACHER's student query carries the instructor predicate", async () => {
    await fetchConnectFunnel(teacherSession, {});
    assert.equal(mockStudentFindMany.mock.callCount(), 1);
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.deepEqual(args.where.classEnrollments.some.class, {
      instructors: { some: { instructorId: "teacher-1" } },
    });
  });

  it("an ADMIN's student query carries NO instructor predicate at all — program-wide", async () => {
    await fetchConnectFunnel(adminSession, {});
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    // Admin+no-classId short-circuits to a plain role filter (see
    // connectManagedStudentIds) — no classEnrollments join at all.
    assert.equal(args.where.classEnrollments, undefined);
    assert.deepEqual(args.where, { role: "student" });
  });
});

describe("fetchConnectFunnel — instructor scoping WITH classId (SEC-W1)", () => {
  beforeEach(resetMocks);

  it("a TEACHER's student query still carries the instructor predicate alongside classId", async () => {
    await fetchConnectFunnel(teacherSession, { classId: "class-1" });
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.equal(args.where.classEnrollments.some.classId, "class-1");
    assert.deepEqual(args.where.classEnrollments.some.class, {
      instructors: { some: { instructorId: "teacher-1" } },
    });
  });

  it("an ADMIN's student query with classId has no instructor predicate", async () => {
    await fetchConnectFunnel(adminSession, { classId: "class-1" });
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.equal(args.where.classEnrollments.some.classId, "class-1");
    assert.equal(args.where.classEnrollments.some.class, undefined);
  });
});

describe("fetchConnectFunnel — program-wide leads stay visible under a class filter (W3)", () => {
  beforeEach(resetMocks);

  it("filters Connection by jobLead.classId OR jobLead.classId:null, never classId alone", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, { classId: "class-1" });
    const [args] = mockConnectionFindMany.mock.calls[0].arguments;
    assert.deepEqual(args.where.jobLead, { OR: [{ classId: "class-1" }, { classId: null }] });
  });

  it("applies no jobLead filter at all when no classId is given", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockConnectionFindMany.mock.calls[0].arguments;
    assert.equal(args.where.jobLead, undefined);
  });
});

describe("fetchConnectFunnel — date-only bounds pushed into the WHERE clause (C2, W12)", () => {
  beforeEach(resetMocks);

  it("resolves from/to to ET-aware UTC instants on Connection.createdAt", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, { from: "2026-06-01", to: "2026-06-30" });
    const [args] = mockConnectionFindMany.mock.calls[0].arguments;
    assert.equal(args.where.createdAt.gte.toISOString(), "2026-06-01T04:00:00.000Z");
    // Exclusive: the ET start of the day AFTER 2026-06-30.
    assert.equal(args.where.createdAt.lt.toISOString(), "2026-07-01T04:00:00.000Z");
  });

  it("applies the SAME bounds to the self-directed Application query", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, { from: "2026-06-01", to: "2026-06-30" });
    const [args] = mockApplicationFindMany.mock.calls[0].arguments;
    assert.equal(args.where.createdAt.gte.toISOString(), "2026-06-01T04:00:00.000Z");
    assert.equal(args.where.createdAt.lt.toISOString(), "2026-07-01T04:00:00.000Z");
  });

  it("applies no createdAt filter when no from/to is given", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockConnectionFindMany.mock.calls[0].arguments;
    assert.equal(args.where.createdAt, undefined);
  });
});

describe("fetchConnectFunnel — the event query is bound by the fetched connection ids (W12)", () => {
  beforeEach(resetMocks);

  it("queries ConnectionEvent only for the ids Connection.findMany actually returned", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    mockConnectionFindMany.mock.mockImplementation(async () => [
      {
        id: "conn-a",
        studentId: "student-1",
        employerId: "e1",
        status: "sent",
        createdAt: new Date(),
        sentAt: null,
        hiredAt: null,
        packet: null,
        employer: { name: "Mountain Metals" },
        jobLead: { classId: null, class: null },
      },
      {
        id: "conn-b",
        studentId: "student-1",
        employerId: "e1",
        status: "sent",
        createdAt: new Date(),
        sentAt: null,
        hiredAt: null,
        packet: null,
        employer: { name: "Mountain Metals" },
        jobLead: { classId: null, class: null },
      },
    ]);
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockConnectionEventFindMany.mock.calls[0].arguments;
    assert.deepEqual(args.where.connectionId, { in: ["conn-a", "conn-b"] });
  });

  it("skips the ConnectionEvent query entirely when there are no connections", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, {});
    assert.equal(mockConnectionEventFindMany.mock.callCount(), 0);
  });
});

describe("fetchConnectFunnel — zero managed students short-circuits", () => {
  beforeEach(resetMocks);

  it("returns an empty funnel without querying Connection/Application at all", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => []);
    const result = await fetchConnectFunnel(teacherSession, {});
    assert.equal(mockConnectionFindMany.mock.callCount(), 0);
    assert.equal(mockApplicationFindMany.mock.callCount(), 0);
    assert.ok(result.stages.every((s) => s.count === 0));
  });
});

describe("fetchConnectFunnel — bounded report reads (W12 partial, 2026-09 second-pass review)", () => {
  beforeEach(resetMocks);

  it("caps connectManagedStudentIds's admin/no-classId student read (the program-wide branch)", async () => {
    await fetchConnectFunnel(adminSession, {});
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.equal(args.take, 50_000);
    assert.equal(MAX_CONNECT_REPORT_ROWS, 50_000, "test literal and the exported constant must agree");
  });

  it("caps connectManagedStudentIds's instructor-scoped student read", async () => {
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockStudentFindMany.mock.calls[0].arguments;
    assert.equal(args.take, 50_000);
    assert.equal(MAX_CONNECT_REPORT_ROWS, 50_000, "test literal and the exported constant must agree");
  });

  it("caps the Connection read at MAX_CONNECT_REPORT_ROWS", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockConnectionFindMany.mock.calls[0].arguments;
    assert.equal(args.take, 50_000);
    assert.equal(MAX_CONNECT_REPORT_ROWS, 50_000, "test literal and the exported constant must agree");
  });

  it("caps the ConnectionEvent read at MAX_CONNECT_REPORT_ROWS", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    mockConnectionFindMany.mock.mockImplementation(async () => [{ id: "c1", employer: { name: "Acme" }, jobLead: { classId: null, class: null } }]);
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockConnectionEventFindMany.mock.calls[0].arguments;
    assert.equal(args.take, 50_000);
    assert.equal(MAX_CONNECT_REPORT_ROWS, 50_000, "test literal and the exported constant must agree");
  });

  it("caps the self-directed Application read at MAX_CONNECT_REPORT_ROWS", async () => {
    mockStudentFindMany.mock.mockImplementation(async () => [{ id: "student-1" }]);
    await fetchConnectFunnel(teacherSession, {});
    const [args] = mockApplicationFindMany.mock.calls[0].arguments;
    assert.equal(args.take, 50_000);
    assert.equal(MAX_CONNECT_REPORT_ROWS, 50_000, "test literal and the exported constant must agree");
  });
});
