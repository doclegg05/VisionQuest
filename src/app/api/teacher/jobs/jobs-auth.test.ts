/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockCount = mock.fn() as any;
const mockScrapeRunFindFirst = mock.fn() as any;
const mockScrapeRunFindMany = mock.fn() as any;
const mockScrapeRunCreate = mock.fn() as any;
const mockScrapeRunUpdate = mock.fn() as any;
const mockEnqueueJob = mock.fn() as any;
const mockProcessJobs = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
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
    notFound: (message = "Not found") => makeHttpError(404, message),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageClass: mockAssertStaffCanManageClass,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobClassConfig: {
        findUnique: mockFindUnique,
      },
      jobListing: {
        count: mockCount,
      },
      jobScrapeRun: {
        findFirst: mockScrapeRunFindFirst,
        findMany: mockScrapeRunFindMany,
        create: mockScrapeRunCreate,
        update: mockScrapeRunUpdate,
      },
    },
  },
});

mock.module("@/lib/jobs", {
  namedExports: {
    enqueueJob: mockEnqueueJob,
    processJobs: mockProcessJobs,
    registerJobHandler: () => undefined,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let configRoute: Awaited<typeof import("./config/route")>;
let refreshRoute: Awaited<typeof import("./refresh/route")>;
let statusRoute: Awaited<typeof import("./status/route")>;

before(async () => {
  configRoute = await import("./config/route");
  refreshRoute = await import("./refresh/route");
  statusRoute = await import("./status/route");
});

describe("teacher job route authorization", () => {
  beforeEach(() => {
    mockAssertStaffCanManageClass.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockCount.mock.resetCalls();
    mockScrapeRunFindFirst.mock.resetCalls();
    mockScrapeRunFindMany.mock.resetCalls();
    mockScrapeRunCreate.mock.resetCalls();
    mockScrapeRunUpdate.mock.resetCalls();
    mockEnqueueJob.mock.resetCalls();
    mockProcessJobs.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockAssertStaffCanManageClass.mock.mockImplementation(async () => ({ id: "class-1" }));
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "config-1",
      classId: "class-1",
      region: "WV",
      radius: 25,
      sources: ["jsearch"],
      autoRefresh: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      lastScrapedAt: null,
    }));
    mockCount.mock.mockImplementation(async () => 7);
    mockScrapeRunFindFirst.mock.mockImplementation(async () => null);
    mockScrapeRunFindMany.mock.mockImplementation(async () => []);
    mockScrapeRunCreate.mock.mockImplementation(async () => ({
      id: "run-1",
      trigger: "manual",
      status: "queued",
      requestedById: session.id,
      backgroundJobId: null,
      totalSources: 0,
      completedSources: 0,
      failedSources: 0,
      totalFetched: 0,
      totalUpserted: 0,
      error: null,
      queuedAt: new Date("2026-01-03T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      sourceResults: [],
    }));
    mockScrapeRunUpdate.mock.mockImplementation(async () => ({
      id: "run-1",
      trigger: "manual",
      status: "queued",
      requestedById: session.id,
      backgroundJobId: "job-1",
      totalSources: 0,
      completedSources: 0,
      failedSources: 0,
      totalFetched: 0,
      totalUpserted: 0,
      error: null,
      queuedAt: new Date("2026-01-03T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      sourceResults: [],
    }));
    mockEnqueueJob.mock.mockImplementation(async () => "job-1");
    mockProcessJobs.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("checks class ownership before returning job config", async () => {
    const req = mockRequest("/api/teacher/jobs/config", {
      searchParams: { classId: "class-1" },
    });

    const res = await configRoute.GET(req as never);

    assert.equal(res.status, 200);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 1);
    assert.deepEqual(mockAssertStaffCanManageClass.mock.calls[0]?.arguments, [session, "class-1"]);
  });

  it("returns 403 and skips config lookup when the teacher does not manage the class", async () => {
    mockAssertStaffCanManageClass.mock.mockImplementationOnce(async () => {
      throw makeHttpError(403, "You do not have access to this class.");
    });

    const req = mockRequest("/api/teacher/jobs/config", {
      searchParams: { classId: "class-99" },
    });

    const res = await configRoute.GET(req as never);
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.match(String(body.error), /do not have access/i);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("checks class ownership before triggering a manual refresh", async () => {
    const req = mockRequest("/api/teacher/jobs/refresh", {
      method: "POST",
      body: { classId: "class-1" },
    });

    const res = await refreshRoute.POST(req as never);

    assert.equal(res.status, 200);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 1);
    assert.deepEqual(mockAssertStaffCanManageClass.mock.calls[0]?.arguments, [session, "class-1"]);
    assert.equal(mockEnqueueJob.mock.callCount(), 1);
    assert.equal(mockProcessJobs.mock.callCount(), 0);
  });

  it("queues a retry for requested enabled sources", async () => {
    const req = mockRequest("/api/teacher/jobs/refresh", {
      method: "POST",
      body: { classId: "class-1", sources: ["jsearch"] },
    });

    const res = await refreshRoute.POST(req as never);

    assert.equal(res.status, 200);
    assert.equal(mockEnqueueJob.mock.callCount(), 1);
    assert.deepEqual(mockEnqueueJob.mock.calls[0]?.arguments[0].payload.sources, ["jsearch"]);
    assert.equal(mockEnqueueJob.mock.calls[0]?.arguments[0].dedupeKey, "scrape:config-1:jsearch");
  });

  it("returns scrape status after checking class ownership", async () => {
    mockScrapeRunFindMany.mock.mockImplementationOnce(async () => [{
      id: "run-2",
      trigger: "manual",
      status: "completed",
      requestedById: session.id,
      backgroundJobId: "job-2",
      totalSources: 2,
      completedSources: 2,
      failedSources: 0,
      totalFetched: 10,
      totalUpserted: 8,
      error: null,
      queuedAt: new Date("2026-01-03T00:00:00.000Z"),
      startedAt: new Date("2026-01-03T00:01:00.000Z"),
      completedAt: new Date("2026-01-03T00:02:00.000Z"),
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:02:00.000Z"),
      sourceResults: [{
        id: "source-1",
        scrapeRunId: "run-2",
        source: "jsearch",
        status: "completed",
        fetchedCount: 10,
        upsertedCount: 8,
        error: null,
        startedAt: new Date("2026-01-03T00:01:00.000Z"),
        completedAt: new Date("2026-01-03T00:02:00.000Z"),
        createdAt: new Date("2026-01-03T00:01:00.000Z"),
        updatedAt: new Date("2026-01-03T00:02:00.000Z"),
      }],
    }]);

    const req = mockRequest("/api/teacher/jobs/status", {
      searchParams: { classId: "class-1" },
    });

    const res = await statusRoute.GET(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 1);
    assert.equal(body.latestRun.status, "completed");
    assert.equal(body.recentRuns.length, 1);
    assert.equal(body.sourceHealth.find((source: { source: string }) => source.source === "jsearch").successRate, 100);
    assert.equal(body.activeJobCount, 7);
  });
});
