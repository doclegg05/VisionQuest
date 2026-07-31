/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const session = mockStudentSession();

const mockOpportunityFindUnique = mock.fn() as any;
const mockFileFindFirst = mock.fn() as any;
const mockFileDeleteMany = mock.fn() as any;
const mockApplicationFindUnique = mock.fn() as any;
const mockApplicationCount = mock.fn() as any;
const mockApplicationUpsert = mock.fn() as any;
const mockSyncStudentAlerts = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockDeleteFile = mock.fn() as any;

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => handler(session, ...args),
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
    mockSyncStudentAlerts.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockDeleteFile.mock.resetCalls();

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
});
