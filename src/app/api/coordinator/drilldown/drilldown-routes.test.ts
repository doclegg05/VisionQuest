/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const mockHasPermission = mock.fn() as any;
const mockRecordStudentView = mock.fn() as any;
const mockRegionCount = mock.fn() as any;
const mockRegionCoordinatorFindUnique = mock.fn() as any;
const mockClassFindMany = mock.fn() as any;
const mockClassFindUnique = mock.fn() as any;
const mockEnrollmentFindMany = mock.fn() as any;
const mockOrientationCount = mock.fn() as any;

let currentSession: ReturnType<typeof mockTeacherSession> | null = mockTeacherSession({
  role: "coordinator",
});

const REGION_A = "clv9q1x2h000008l3f4g5h6i7";
const REGION_B = "clv9q1x2h000108l3f4g5h6i8";
const CLASS_A = "clv9q1x2h000208l3f4g5h6i9";
const CLASS_B = "clv9q1x2h000308l3f4g5h6ia";
const CLASS_NO_REGION = "clv9q1x2h000408l3f4g5h6ib";

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
    forbidden: (message?: string) => makeHttpError(403, message ?? "Forbidden"),
    unauthorized: (message?: string) => makeHttpError(401, message ?? "Unauthorized"),
    notFound: (message: string) => makeHttpError(404, message),
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/rbac", { namedExports: { hasPermission: mockHasPermission } });
mock.module("@/lib/audit", { namedExports: { recordStudentView: mockRecordStudentView } });

// Only the database is mocked; the role gate, the region gate and the
// drilldown reads are the real functions (a mocked predicate hides its bugs).
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      region: { count: mockRegionCount },
      regionCoordinator: { findUnique: mockRegionCoordinatorFindUnique },
      spokesClass: { findMany: mockClassFindMany, findUnique: mockClassFindUnique },
      studentClassEnrollment: { findMany: mockEnrollmentFindMany },
      orientationItem: { count: mockOrientationCount },
    },
    prismaAdmin: {},
  },
});

let regionRoute: Awaited<typeof import("./regions/[regionId]/route")>;
let classRoute: Awaited<typeof import("./classes/[classId]/route")>;

before(async () => {
  regionRoute = await import("./regions/[regionId]/route");
  classRoute = await import("./classes/[classId]/route");
});

function getRegion(regionId: string) {
  const req = mockRequest(`/api/coordinator/drilldown/regions/${regionId}`, { method: "GET" });
  return regionRoute.GET(req as never, { params: Promise.resolve({ regionId }) });
}
function getClass(classId: string) {
  const req = mockRequest(`/api/coordinator/drilldown/classes/${classId}`, { method: "GET" });
  return classRoute.GET(req as never, { params: Promise.resolve({ classId }) });
}

const CLASS_REGION: Record<string, string | null> = {
  [CLASS_A]: REGION_A,
  [CLASS_B]: REGION_B,
  [CLASS_NO_REGION]: null,
};

beforeEach(() => {
  for (const m of [
    mockHasPermission, mockRecordStudentView, mockRegionCount, mockRegionCoordinatorFindUnique,
    mockClassFindMany, mockClassFindUnique, mockEnrollmentFindMany, mockOrientationCount,
  ]) {
    m.mock.resetCalls();
  }
  currentSession = mockTeacherSession({ role: "coordinator" });
  mockHasPermission.mock.mockImplementation(async () => true);
  mockRecordStudentView.mock.mockImplementation(async () => undefined);
  mockRegionCount.mock.mockImplementation(async () => 1);
  // Assigned to region A and nothing else.
  mockRegionCoordinatorFindUnique.mock.mockImplementation(async (args: any) =>
    args.where.regionId_coordinatorId.regionId === REGION_A ? { regionId: REGION_A } : null,
  );
  mockClassFindMany.mock.mockImplementation(async () => []);
  mockClassFindUnique.mock.mockImplementation(async (args: any) =>
    args.where.id in CLASS_REGION ? { regionId: CLASS_REGION[args.where.id] } : null,
  );
  mockEnrollmentFindMany.mock.mockImplementation(async () => [
    {
      enrolledAt: new Date("2026-09-01T00:00:00Z"),
      student: { id: "s1", displayName: "Sam", progression: null, orientationProgress: [], goals: [] },
    },
  ]);
  mockOrientationCount.mock.mockImplementation(async () => 2);
});

describe("region drill-down route", () => {
  it("answers 200 with the success envelope for the coordinator's own region", async () => {
    const res = await getRegion(REGION_A);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { instructors: [] } });
  });

  it("answers 403 for another region, before any class read", async () => {
    const res = await getRegion(REGION_B);
    assert.equal(res.status, 403);
    assert.equal(mockClassFindMany.mock.callCount(), 0);
  });

  it("answers 200 for a program coordinator on any region", async () => {
    currentSession = mockTeacherSession({ role: "program_coordinator" });
    assert.equal((await getRegion(REGION_B)).status, 200);
  });

  it("answers 403 for a coordinator with no regions", async () => {
    mockRegionCoordinatorFindUnique.mock.mockImplementation(async () => null);
    assert.equal((await getRegion(REGION_A)).status, 403);
  });

  it("answers 400 for a malformed region id", async () => {
    assert.equal((await getRegion("nope")).status, 400);
  });

  it("answers 403 for teachers and students", async () => {
    currentSession = mockTeacherSession({ role: "teacher" });
    assert.equal((await getRegion(REGION_A)).status, 403);
    currentSession = mockTeacherSession({ role: "student" });
    assert.equal((await getRegion(REGION_A)).status, 403);
  });
});

describe("class roster route", () => {
  it("answers 200 with the roster and audits each student viewed", async () => {
    const res = await getClass(CLASS_A);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(Object.keys(body.data.students[0]).sort(), [
      "displayName", "enrolledAt", "goalsAchieved", "goalsSet", "id", "orientationComplete",
    ]);
    assert.equal(mockRecordStudentView.mock.callCount(), 1);
    assert.deepEqual(mockRecordStudentView.mock.calls[0].arguments[0], {
      actorId: currentSession!.id,
      actorRole: "coordinator",
      targetStudentId: "s1",
      surface: "class_roster",
    });
  });

  it("answers 403 for a class in another region, with no roster read and no audit", async () => {
    const res = await getClass(CLASS_B);
    assert.equal(res.status, 403);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0);
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
  });

  it("answers 403 to a regional coordinator for a class with no region", async () => {
    assert.equal((await getClass(CLASS_NO_REGION)).status, 403);
  });

  it("answers 200 to a program coordinator for any class, including one with no region", async () => {
    currentSession = mockTeacherSession({ role: "program_coordinator" });
    assert.equal((await getClass(CLASS_B)).status, 200);
    assert.equal((await getClass(CLASS_NO_REGION)).status, 200);
  });

  it("answers 403 for a coordinator with no regions", async () => {
    mockRegionCoordinatorFindUnique.mock.mockImplementation(async () => null);
    assert.equal((await getClass(CLASS_A)).status, 403);
  });

  it("answers 403 for a class the coordinator cannot see (hidden by RLS) and 404 for a missing one to admins", async () => {
    assert.equal((await getClass("clv9q1x2h000508l3f4g5h6ic")).status, 403);
    currentSession = mockTeacherSession({ role: "admin" });
    assert.equal((await getClass("clv9q1x2h000508l3f4g5h6ic")).status, 404);
  });

  it("answers 400 for a malformed class id", async () => {
    assert.equal((await getClass("nope")).status, 400);
  });
});
