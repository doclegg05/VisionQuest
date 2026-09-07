/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// C7 (finding 9 of the 2026-09-06 hunt): the coordinator dashboard's forms
// panel called /api/teacher/forms/templates (withTeacherAuth — coordinators
// are refused by the wrapper) and linked /api/teacher/forms/[id]/export
// (admin only in effect). A real coordinator saw an error box and a dead CSV
// link. This route is the coordinator-reachable, region-scoped replacement.
// ---------------------------------------------------------------------------

const mockHasPermission = mock.fn() as any;
const mockRegionCoordinatorFindUnique = mock.fn() as any;
const mockRegionCount = mock.fn() as any;
const mockClassFindMany = mock.fn() as any;
const mockTemplateFindMany = mock.fn() as any;
const mockStudentFindMany = mock.fn() as any;
const mockAssignmentCount = mock.fn() as any;
const mockResponseCount = mock.fn() as any;

let currentSession: ReturnType<typeof mockTeacherSession> | null = mockTeacherSession({
  role: "coordinator",
});

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: NonNullable<typeof currentSession>, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          // withAuth rejects a request with no session before the handler runs.
          if (!currentSession) throw makeHttpError(401, "Unauthorized");
          return await handler(currentSession, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    // Reproduced faithfully from src/lib/api-error.ts; the composition it
    // feeds (canReachFormCsvExport) is pinned mock-free in
    // src/lib/forms/region-rollup.test.ts.
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    forbidden: (message?: string) => makeHttpError(403, message ?? "Forbidden"),
    unauthorized: (message?: string) => makeHttpError(401, message ?? "Unauthorized"),
    notFound: (message: string) => makeHttpError(404, message),
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/rbac", {
  namedExports: { hasPermission: mockHasPermission },
});

// Only the database is mocked. The region gate, the region-scoped counting
// and the CSV-reachability predicate are the REAL functions this route asks —
// a route test that mocked them would be green for the life of a bug in them
// (.claude/MEMORY.md, 2026-09-06).
mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      region: { count: mockRegionCount },
      regionCoordinator: { findUnique: mockRegionCoordinatorFindUnique },
      spokesClass: { findMany: mockClassFindMany },
      formTemplate: { findMany: mockTemplateFindMany },
      student: { findMany: mockStudentFindMany },
      formAssignment: { count: mockAssignmentCount },
      formResponse: { count: mockResponseCount },
    },
    prisma: {},
  },
});

const ROLLUP = {
  regionId: "rgn1",
  classCount: 2,
  studentCount: 7,
  templates: [
    {
      templateId: "tpl1",
      title: "SPOKES Intake",
      isOfficial: true,
      assignmentCount: 2,
      responseCount: 5,
      completionRate: 0.714,
    },
  ],
};

/** Seeds the mocked admin client so the real rollup produces ROLLUP. */
function seedRollupRows() {
  mockClassFindMany.mock.mockImplementation(async () => [{ id: "cls1" }, { id: "cls2" }]);
  mockTemplateFindMany.mock.mockImplementation(async () => [
    { id: "tpl1", title: "SPOKES Intake", isOfficial: true },
  ]);
  mockStudentFindMany.mock.mockImplementation(async () =>
    Array.from({ length: 7 }, (_, i) => ({ id: `stu${i}` })),
  );
  mockAssignmentCount.mock.mockImplementation(async () => 2);
  mockResponseCount.mock.mockImplementation(async () => 5);
}

let route: Awaited<typeof import("./forms/[regionId]/route")>;

before(async () => {
  route = await import("./forms/[regionId]/route");
});

function get(regionId: string) {
  const req = mockRequest(`/api/coordinator/forms/${regionId}`, { method: "GET" });
  return route.GET(req as never, { params: Promise.resolve({ regionId }) });
}

describe("GET /api/coordinator/forms/[regionId] — authorization", () => {
  beforeEach(() => {
    for (const m of [
      mockHasPermission,
      mockRegionCoordinatorFindUnique,
      mockRegionCount,
      mockClassFindMany,
      mockTemplateFindMany,
      mockStudentFindMany,
      mockAssignmentCount,
      mockResponseCount,
    ]) {
      m.mock.resetCalls();
    }

    currentSession = mockTeacherSession({ role: "coordinator" });
    mockHasPermission.mock.mockImplementation(async () => true);
    // Assigned to rgn1 and to nothing else.
    mockRegionCoordinatorFindUnique.mock.mockImplementation(
      async (args: any) =>
        args.where.regionId_coordinatorId.regionId === "rgn1" ? { regionId: "rgn1" } : null,
    );
    mockRegionCount.mock.mockImplementation(async () => 1);
    seedRollupRows();
  });

  it("returns 200 for a coordinator assigned to the region", async () => {
    const res = await get("rgn1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.rollup, ROLLUP);
  });

  it("scopes every read to the region in the URL, never a caller-supplied wider scope", async () => {
    await get("rgn1");

    assert.equal(
      mockRegionCoordinatorFindUnique.mock.calls[0].arguments[0].where.regionId_coordinatorId
        .regionId,
      "rgn1",
      "the assignment row is looked up for the requested region and this caller",
    );
    assert.equal(
      mockRegionCoordinatorFindUnique.mock.calls[0].arguments[0].where.regionId_coordinatorId
        .coordinatorId,
      currentSession!.id,
    );
    assert.deepEqual(mockClassFindMany.mock.calls[0].arguments[0].where, {
      regionId: "rgn1",
      status: { not: "archived" },
    });
    assert.deepEqual(
      mockResponseCount.mock.calls[0].arguments[0].where.student,
      { classEnrollments: { some: { classId: { in: ["cls1", "cls2"] } } } },
      "responses are bounded by the region's classes",
    );
  });

  it("returns 403 for a coordinator NOT assigned to the region, before any data read", async () => {
    const res = await get("rgn-other");
    assert.equal(res.status, 403);
    assert.equal(
      mockClassFindMany.mock.callCount() + mockResponseCount.mock.callCount(),
      0,
      "an out-of-region request must not read a single class or form row",
    );
  });

  it("returns 403 when the coordinator lacks the RBAC permission", async () => {
    mockHasPermission.mock.mockImplementation(async () => false);
    const res = await get("rgn1");
    assert.equal(res.status, 403);
    assert.equal(mockRegionCoordinatorFindUnique.mock.callCount(), 0);
    assert.equal(mockClassFindMany.mock.callCount(), 0);
  });

  it("checks the forms permission, not merely the dashboard permission", async () => {
    await get("rgn1");
    assert.equal(mockHasPermission.mock.calls[0].arguments[1], "coordinator.student.view.region");
  });

  it("returns 403 for a teacher session", async () => {
    currentSession = mockTeacherSession({ role: "teacher" });
    const res = await get("rgn1");
    assert.equal(res.status, 403);
    assert.equal(mockHasPermission.mock.callCount(), 0);
    assert.equal(mockClassFindMany.mock.callCount(), 0);
  });

  it("returns 403 for a student session", async () => {
    currentSession = mockTeacherSession({ role: "student" });
    const res = await get("rgn1");
    assert.equal(res.status, 403);
    assert.equal(mockClassFindMany.mock.callCount(), 0);
  });

  it("returns 401 with no session", async () => {
    currentSession = null;
    const res = await get("rgn1");
    assert.equal(res.status, 401);
    assert.equal(mockClassFindMany.mock.callCount(), 0);
  });

  it("admin sessions skip the permission check but keep the region gate", async () => {
    currentSession = mockTeacherSession({ role: "admin" });
    const res = await get("rgn1");
    assert.equal(res.status, 200);
    assert.equal(mockHasPermission.mock.callCount(), 0);
    assert.equal(
      mockRegionCount.mock.callCount(),
      1,
      "an admin still names one region, so the region gate still runs",
    );
    assert.equal(
      mockRegionCoordinatorFindUnique.mock.callCount(),
      0,
      "an admin needs no RegionCoordinator row",
    );
  });

  it("never serves a CSV — the bulk export stays admin-only on its own route", async () => {
    const res = await get("rgn1");
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  });

  // The panel renders the CSV link from this flag rather than from a role
  // string of its own, so the link cannot outlive the gate on the export
  // route. A coordinator seeing a link they will be 403'd on is the exact
  // C7 defect.
  it("tells a coordinator they cannot reach the admin CSV export", async () => {
    const res = await get("rgn1");
    const body = await res.json();
    assert.equal(body.canExport, false);
  });

  it("tells an admin they can reach the admin CSV export", async () => {
    currentSession = mockTeacherSession({ role: "admin" });
    const res = await get("rgn1");
    const body = await res.json();
    assert.equal(body.canExport, true);
  });
});
