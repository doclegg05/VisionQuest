/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { studentLogKey } from "@/lib/log-keys";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const session = mockStudentSession();

const mockOpportunityFindUnique = mock.fn() as any;
const mockFileFindFirst = mock.fn() as any;
const mockFileDeleteMany = mock.fn() as any;
const mockApplicationFindUnique = mock.fn() as any;
const mockApplicationCount = mock.fn() as any;
const mockApplicationUpsert = mock.fn() as any;
const mockDiscoveryFindUnique = mock.fn() as any;
const mockSyncStudentAlerts = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockDeleteFile = mock.fn() as any;
const mockWarn = mock.fn<(message: string, context?: Record<string, unknown>) => void>();
const mockError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

// Mirrors withErrorHandler: an ApiError keeps its status, anything else is a
// 500, so a thrown side effect shows up the way the student would see it.
function toResponse(err: unknown): Response {
  if (err instanceof Error && err.name === "ApiError" && "statusCode" in err) {
    return Response.json({ error: err.message }, { status: Number(err.statusCode) });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (err) {
          return toResponse(err);
        }
      },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      opportunity: {
        findUnique: mockOpportunityFindUnique,
      },
      fileUpload: {
        findFirst: mockFileFindFirst,
        deleteMany: mockFileDeleteMany,
      },
      application: {
        findUnique: mockApplicationFindUnique,
        count: mockApplicationCount,
        upsert: mockApplicationUpsert,
      },
      careerDiscovery: {
        findUnique: mockDiscoveryFindUnique,
      },
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mockSyncStudentAlerts,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    deleteFile: mockDeleteFile,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: mockWarn,
      error: mockError,
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("POST /api/applications", () => {
  beforeEach(() => {
    mockOpportunityFindUnique.mock.resetCalls();
    mockFileFindFirst.mock.resetCalls();
    mockFileDeleteMany.mock.resetCalls();
    mockApplicationFindUnique.mock.resetCalls();
    mockApplicationCount.mock.resetCalls();
    mockApplicationUpsert.mock.resetCalls();
    mockDiscoveryFindUnique.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockDeleteFile.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();

    mockOpportunityFindUnique.mock.mockImplementation(async () => ({
      id: "opportunity-1",
      title: "Office Assistant",
    }));
    mockFileFindFirst.mock.mockImplementation(async () => null);
    mockFileDeleteMany.mock.mockImplementation(async () => ({ count: 0 }));
    mockApplicationFindUnique.mock.mockImplementation(async () => ({
      id: "application-1",
      resumeFileId: null,
      appliedAt: null,
    }));
    mockApplicationCount.mock.mockImplementation(async () => 0);
    mockDiscoveryFindUnique.mock.mockImplementation(async () => ({
      topClusters: ["office-admin", "tech-digital"],
    }));
    mockApplicationUpsert.mock.mockImplementation(async (args: any) => ({
      id: "application-1",
      studentId: session.id,
      opportunityId: args.create.opportunityId,
      status: args.update.status,
      appliedAt: args.update.appliedAt ?? null,
    }));
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockDeleteFile.mock.mockImplementation(async () => undefined);
  });

  for (const status of ["interviewing", "offer"] as const) {
    it(`sets appliedAt when a saved application first moves to ${status}`, async () => {
      const req = mockRequest("/api/applications", {
        method: "POST",
        body: { opportunityId: "opportunity-1", status },
      });

      const res = await route.POST(req as never);

      assert.equal(res.status, 200);
      assert.equal(
        mockApplicationFindUnique.mock.calls[0]?.arguments[0].select.appliedAt,
        true,
      );
      assert.ok(mockApplicationUpsert.mock.calls[0]?.arguments[0].update.appliedAt instanceof Date);
    });
  }

  it("preserves the first appliedAt timestamp on later status changes", async () => {
    const existingAppliedAt = new Date("2026-05-01T12:00:00.000Z");
    mockApplicationFindUnique.mock.mockImplementationOnce(async () => ({
      id: "application-1",
      resumeFileId: null,
      appliedAt: existingAppliedAt,
    }));

    const req = mockRequest("/api/applications", {
      method: "POST",
      body: { opportunityId: "opportunity-1", status: "offer" },
    });

    const res = await route.POST(req as never);

    assert.equal(res.status, 200);
    assert.equal(mockApplicationUpsert.mock.calls[0]?.arguments[0].update.appliedAt, undefined);
  });

  describe("pathway provenance", () => {
    function newApplicationRequest() {
      // No existing row -> the upsert takes its create branch.
      mockApplicationFindUnique.mock.mockImplementationOnce(async () => null);
      return mockRequest("/api/applications", {
        method: "POST",
        body: { opportunityId: "opportunity-1", status: "applied" },
      });
    }

    it("stamps the student's current pathway on a brand-new application", async () => {
      const res = await route.POST(newApplicationRequest() as never);

      assert.equal(res.status, 200);
      const create = mockApplicationUpsert.mock.calls[0]?.arguments[0].create;
      assert.equal(create.pathwayClusterId, "office-admin");
      assert.ok(create.pathwaySnapshotAt instanceof Date);
      assert.deepEqual(mockDiscoveryFindUnique.mock.calls[0]?.arguments[0].where, {
        studentId: session.id,
      });
    });

    it("records no pathway when the student has not finished discovery", async () => {
      mockDiscoveryFindUnique.mock.mockImplementationOnce(async () => null);

      const res = await route.POST(newApplicationRequest() as never);

      assert.equal(res.status, 200);
      const create = mockApplicationUpsert.mock.calls[0]?.arguments[0].create;
      assert.equal(create.pathwayClusterId, null);
      assert.equal(create.pathwaySnapshotAt, null);
    });

    it("never rewrites provenance on a later status change", async () => {
      // Provenance answers "what pathway were they on when they applied".
      // A status update must leave the original snapshot alone.
      const req = mockRequest("/api/applications", {
        method: "POST",
        body: { opportunityId: "opportunity-1", status: "offer" },
      });

      const res = await route.POST(req as never);

      assert.equal(res.status, 200);
      const update = mockApplicationUpsert.mock.calls[0]?.arguments[0].update;
      assert.ok(!("pathwayClusterId" in update), "update must not touch pathwayClusterId");
      assert.ok(!("pathwaySnapshotAt" in update), "update must not touch pathwaySnapshotAt");
    });

    it("skips the discovery read entirely when the application already exists", async () => {
      const req = mockRequest("/api/applications", {
        method: "POST",
        body: { opportunityId: "opportunity-1", status: "offer" },
      });

      await route.POST(req as never);

      assert.equal(mockDiscoveryFindUnique.mock.calls.length, 0);
    });
  });
  // Review finding F26 / API-U-01: the upsert is the durable write. The resume
  // cleanup, the audit row, and the alert sync run after it and must never
  // turn a saved application into a failed request.
  describe("side effects after the saved write", () => {
    function applyRequest() {
      return mockRequest("/api/applications", {
        method: "POST",
        body: { opportunityId: "opportunity-1", status: "applied" },
      });
    }

    it("returns 200 and warns when the alert sync fails after the application saved", async () => {
      mockSyncStudentAlerts.mock.mockImplementation(async () => {
        throw new Error("advising sync timed out");
      });

      const res = await route.POST(applyRequest() as never);

      assert.equal(mockApplicationUpsert.mock.callCount(), 1, "the application was saved");
      assert.equal(res.status, 200, "a saved application must not be reported as failed");
      assert.equal((await res.json()).application.id, "application-1");
      assert.equal(mockWarn.mock.callCount(), 1);
      assert.equal(mockError.mock.callCount(), 0);
      const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
      assert.equal(payload.surface, "applications");
      assert.equal(payload.student, studentLogKey(session.id));
      const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
      assert.ok(!serialized.includes(session.id), `log line leaked the student id: ${serialized}`);
    });

    it("returns 200 and logs an error when the audit row fails after the application saved", async () => {
      mockLogAuditEvent.mock.mockImplementation(async () => {
        throw new Error("audit insert failed");
      });

      const res = await route.POST(applyRequest() as never);

      assert.equal(res.status, 200);
      assert.equal(mockError.mock.callCount(), 1, "an audit gap is an error, not a warning");
      assert.equal(mockError.mock.calls[0].arguments[1]?.effect, "logAuditEvent");
      assert.equal(mockError.mock.calls[0].arguments[1]?.student, studentLogKey(session.id));
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 1, "later side effects still run");
    });

    it("returns 200 and warns when the detached resume cleanup fails after the application saved", async () => {
      mockApplicationFindUnique.mock.mockImplementationOnce(async () => ({
        id: "application-1",
        resumeFileId: "old-generated-resume",
        appliedAt: null,
      }));
      mockFileFindFirst.mock.mockImplementation(async () => {
        throw new Error("fileUpload lookup failed");
      });

      const res = await route.POST(applyRequest() as never);

      assert.equal(res.status, 200);
      assert.equal(mockWarn.mock.callCount(), 1);
      assert.equal(mockWarn.mock.calls[0].arguments[1]?.effect, "cleanupDetachedGeneratedResumeFile");
      assert.equal(mockLogAuditEvent.mock.callCount(), 1, "the audit row is still written");
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 1, "the alert sync still runs");
    });

    it("still reports failure when the application write itself fails", async () => {
      mockApplicationUpsert.mock.mockImplementation(async () => {
        throw new Error("connection reset");
      });

      const res = await route.POST(applyRequest() as never);

      assert.equal(res.status, 500);
      assert.equal(mockLogAuditEvent.mock.callCount(), 0);
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
    });
  });
});
