/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockCount = mock.fn() as any;
const mockJobListingFindMany = mock.fn() as any;
const mockScrapeRunFindFirst = mock.fn() as any;
const mockScrapeRunFindMany = mock.fn() as any;
const mockScrapeRunCreate = mock.fn() as any;
const mockScrapeRunUpdate = mock.fn() as any;
const mockEnqueueJob = mock.fn() as any;
const mockProcessJobById = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function activeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Office Assistant",
    company: "Acme",
    location: "Summersville, WV",
    workMode: "onsite",
    salary: null,
    salaryMin: null,
    description: "Answer phones, schedule appointments, and keep office records updated.",
    url: "https://example.com/jobs/1",
    source: "jsearch",
    sourceType: "api",
    sourceId: "jsearch:1",
    clusters: ["office-admin"],
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    _count: { savedByStudents: 0 },
    ...overrides,
  };
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
        findMany: mockJobListingFindMany,
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
    processJobById: mockProcessJobById,
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
let resultsRoute: Awaited<typeof import("./results/route")>;

before(async () => {
  configRoute = await import("./config/route");
  refreshRoute = await import("./refresh/route");
  statusRoute = await import("./status/route");
  resultsRoute = await import("./results/route");
});

describe("teacher job route authorization", () => {
  beforeEach(() => {
    mockAssertStaffCanManageClass.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockCount.mock.resetCalls();
    mockJobListingFindMany.mock.resetCalls();
    mockScrapeRunFindFirst.mock.resetCalls();
    mockScrapeRunFindMany.mock.resetCalls();
    mockScrapeRunCreate.mock.resetCalls();
    mockScrapeRunUpdate.mock.resetCalls();
    mockEnqueueJob.mock.resetCalls();
    mockProcessJobById.mock.resetCalls();
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
    mockJobListingFindMany.mock.mockImplementation(async () => [
      activeJob({ id: "job-1", title: "Office Assistant" }),
      activeJob({ id: "job-2", title: "Bookkeeper" }),
      activeJob({ id: "job-3", title: "IT Support Specialist" }),
      activeJob({ id: "job-4", title: "Customer Service Representative" }),
      activeJob({ id: "job-5", title: "Data Entry Clerk" }),
      activeJob({ id: "job-6", title: "Administrative Coordinator" }),
      activeJob({ id: "job-7", title: "Receptionist" }),
    ]);
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
    mockProcessJobById.mock.mockImplementation(async () => 1);
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
    assert.equal(mockProcessJobById.mock.callCount(), 1);
    assert.deepEqual(mockProcessJobById.mock.calls[0]?.arguments, ["job-1"]);
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
    assert.equal(mockProcessJobById.mock.callCount(), 1);
  });

  it("re-kicks an existing queued refresh job when the teacher retries", async () => {
    mockScrapeRunFindFirst.mock.mockImplementationOnce(async () => ({
      id: "run-existing",
      trigger: "manual",
      status: "queued",
      requestedById: session.id,
      backgroundJobId: "job-existing",
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

    const req = mockRequest("/api/teacher/jobs/refresh", {
      method: "POST",
      body: { classId: "class-1" },
    });

    const res = await refreshRoute.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.queued, false);
    assert.equal(mockEnqueueJob.mock.callCount(), 0);
    assert.equal(mockProcessJobById.mock.callCount(), 1);
    assert.deepEqual(mockProcessJobById.mock.calls[0]?.arguments, ["job-existing"]);
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
    assert.equal(body.lastScrapedAt, null);
  });

  it("returns teacher job results grouped by duplicate posting", async () => {
    mockJobListingFindMany.mock.mockImplementationOnce(async () => [
      activeJob({
        id: "job-primary",
        title: "Office Assistant",
        company: "Acme Inc.",
        location: "Summersville, WV",
        source: "usajobs",
        sourceId: "usajobs:1",
        salaryMin: 20,
        _count: { savedByStudents: 1 },
      }),
      activeJob({
        id: "job-duplicate",
        title: "Office Assistant - Full Time",
        company: "Acme",
        location: "Summersville, West Virginia",
        source: "jsearch",
        sourceId: "jsearch:2",
        url: "https://example.com/jobs/2",
      }),
      activeJob({
        id: "job-distinct",
        title: "Bookkeeper",
        company: "Ledger Co",
        location: "Charleston, WV",
        source: "adzuna",
        sourceId: "adzuna:3",
        clusters: ["finance-bookkeeping"],
      }),
    ]);

    const req = mockRequest("/api/teacher/jobs/results", {
      searchParams: { classId: "class-1" },
    });

    const res = await resultsRoute.GET(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.totalListings, 3);
    assert.equal(body.totalUnique, 2);
    assert.equal(body.duplicateListings, 1);
    assert.equal(body.jobs.length, 2);
    const officeJob = body.jobs.find((job: { title: string }) => job.title === "Office Assistant");
    assert.equal(officeJob.duplicateCount, 2);
    assert.deepEqual(
      officeJob.sources.map((source: { value: string }) => source.value),
      ["usajobs", "jsearch"],
    );
    assert.deepEqual(officeJob.workModes, ["onsite"]);
  });

  it("filters teacher job results by work mode", async () => {
    mockJobListingFindMany.mock.mockImplementationOnce(async () => [
      activeJob({
        id: "job-local",
        title: "Office Assistant",
        location: "Summersville, WV",
        workMode: "onsite",
      }),
      activeJob({
        id: "job-remote",
        title: "Remote Administrative Assistant",
        location: "United States",
        workMode: "remote",
        source: "remotive",
        sourceId: "remotive:1",
      }),
    ]);

    const req = mockRequest("/api/teacher/jobs/results", {
      searchParams: { classId: "class-1", workMode: "remote" },
    });

    const res = await resultsRoute.GET(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].id, "job-remote");
    assert.equal(body.jobs[0].workMode, "remote");
  });
});
