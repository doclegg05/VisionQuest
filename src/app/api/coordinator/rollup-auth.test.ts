/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const mockHasPermission = mock.fn() as any;
const mockCoordinatorHasRegion = mock.fn() as any;
const mockGetRegionRollup = mock.fn() as any;
const mockListInstructorMetrics = mock.fn() as any;
const mockCountUnregioned = mock.fn() as any;

let currentSession = mockTeacherSession({ role: "coordinator" });

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof currentSession, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
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

mock.module("@/lib/rbac", {
  namedExports: {
    hasPermission: mockHasPermission,
  },
});

mock.module("@/lib/region", {
  namedExports: {
    coordinatorHasRegion: mockCoordinatorHasRegion,
    countUnregionedClasses: mockCountUnregioned,
  },
});

mock.module("@/lib/grant-metrics", {
  namedExports: {
    currentMonthBounds: () => ({
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
    }),
    getRegionRollup: mockGetRegionRollup,
  },
});

mock.module("@/lib/instructor-metrics", {
  namedExports: {
    listInstructorMetricsForRegion: mockListInstructorMetrics,
  },
});

let route: Awaited<typeof import("./rollup/[regionId]/route")>;

before(async () => {
  route = await import("./rollup/[regionId]/route");
});

describe("GET /api/coordinator/rollup/[regionId] — authorization", () => {
  beforeEach(() => {
    mockHasPermission.mock.resetCalls();
    mockCoordinatorHasRegion.mock.resetCalls();
    mockGetRegionRollup.mock.resetCalls();
    mockListInstructorMetrics.mock.resetCalls();
    mockCountUnregioned.mock.resetCalls();

    currentSession = mockTeacherSession({ role: "coordinator" });

    mockHasPermission.mock.mockImplementation(async () => true);
    mockCoordinatorHasRegion.mock.mockImplementation(async () => true);
    mockListInstructorMetrics.mock.mockImplementation(async () => []);
    mockCountUnregioned.mock.mockImplementation(async () => 0);
    mockGetRegionRollup.mock.mockImplementation(async () => ({
      regionId: "rgn1",
      regionName: "North",
      periodStart: new Date("2026-04-01T00:00:00Z"),
      periodEnd: new Date("2026-05-01T00:00:00Z"),
      headline: {
        activeStudents: 0,
        enrollmentsInPeriod: 0,
        certificationsInPeriod: 0,
        placementsInPeriod: 0,
        gedEarnedInPeriod: 0,
      },
      grantGoals: [],
      classCount: 0,
    }));
  });

  it("returns 200 when coordinator is assigned to the region", async () => {
    const req = mockRequest("/api/coordinator/rollup/rgn1", { method: "GET" });
    const res = await route.GET(req as never, { params: Promise.resolve({ regionId: "rgn1" }) });
    assert.equal(res.status, 200);
    assert.equal(mockCoordinatorHasRegion.mock.callCount(), 1);
  });

  it("returns 403 when coordinator is not assigned to the region", async () => {
    mockCoordinatorHasRegion.mock.mockImplementationOnce(async () => false);
    const req = mockRequest("/api/coordinator/rollup/rgn-other", { method: "GET" });
    const res = await route.GET(req as never, { params: Promise.resolve({ regionId: "rgn-other" }) });
    assert.equal(res.status, 403);
    assert.equal(mockGetRegionRollup.mock.callCount(), 0);
  });

  it("returns 403 when session has no permission", async () => {
    mockHasPermission.mock.mockImplementation(async () => false);
    const req = mockRequest("/api/coordinator/rollup/rgn1", { method: "GET" });
    const res = await route.GET(req as never, { params: Promise.resolve({ regionId: "rgn1" }) });
    assert.equal(res.status, 403);
    assert.equal(mockCoordinatorHasRegion.mock.callCount(), 0);
  });

  it("returns 403 for a teacher session (role gate)", async () => {
    currentSession = mockTeacherSession({ role: "teacher" });
    const req = mockRequest("/api/coordinator/rollup/rgn1", { method: "GET" });
    const res = await route.GET(req as never, { params: Promise.resolve({ regionId: "rgn1" }) });
    assert.equal(res.status, 403);
    assert.equal(mockHasPermission.mock.callCount(), 0);
  });

  it("admin session skips the permission check", async () => {
    currentSession = mockTeacherSession({ role: "admin" });
    const req = mockRequest("/api/coordinator/rollup/rgn1", { method: "GET" });
    const res = await route.GET(req as never, { params: Promise.resolve({ regionId: "rgn1" }) });
    assert.equal(res.status, 200);
    assert.equal(mockHasPermission.mock.callCount(), 0);
  });
});
