/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockCount = mock.fn() as any;
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

before(async () => {
  configRoute = await import("./config/route");
  refreshRoute = await import("./refresh/route");
});

describe("teacher job route authorization", () => {
  beforeEach(() => {
    mockAssertStaffCanManageClass.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockCount.mock.resetCalls();
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
  });
});
