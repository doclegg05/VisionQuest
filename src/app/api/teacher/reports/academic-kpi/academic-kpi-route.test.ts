/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const session = mockTeacherSession();
const mockListManagedStudentIds = mock.fn() as any;
const mockStudentFindMany = mock.fn() as any;
const mockOrientationItemCount = mock.fn() as any;

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => handler(session, ...args),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    listManagedStudentIds: mockListManagedStudentIds,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findMany: mockStudentFindMany,
      },
      orientationItem: {
        count: mockOrientationItemCount,
      },
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/teacher/reports/academic-kpi", () => {
  beforeEach(() => {
    mockListManagedStudentIds.mock.resetCalls();
    mockStudentFindMany.mock.resetCalls();
    mockOrientationItemCount.mock.resetCalls();

    mockListManagedStudentIds.mock.mockImplementation(async () => ["student-1"]);
    mockOrientationItemCount.mock.mockImplementation(async () => 2);
    mockStudentFindMany.mock.mockImplementation(async () => [{
      id: "student-1",
      createdAt: new Date("2026-01-01T12:00:00.000Z"),
      conversations: [],
      goals: [],
      progression: null,
      certifications: [],
      portfolioItems: [],
      resumeData: null,
      publicCredentialPage: null,
      orientationProgress: [{
        completed: true,
        completedAt: new Date("2026-01-02T12:00:00.000Z"),
      }],
    }]);
  });

  it("uses only required verified orientation work and returns the activity field contract", async () => {
    const req = mockRequest("/api/teacher/reports/academic-kpi", { method: "GET" });

    const res = await route.GET(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(
      mockOrientationItemCount.mock.calls[0]?.arguments[0],
      { where: { required: true } },
    );
    assert.deepEqual(
      mockStudentFindMany.mock.calls[0]?.arguments[0].select.orientationProgress.where,
      {
        completed: true,
        item: { required: true },
      },
    );
    assert.equal(body.readinessDistribution.avgScore, 5);
    assert.ok("linksWithActivity" in body.resourcePipeline);
    assert.ok(!("linksWithEvidence" in body.resourcePipeline));
  });
});
