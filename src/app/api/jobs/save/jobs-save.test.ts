/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const session = mockStudentSession();

const mockEnrollmentFindFirst = mock.fn() as any;
const mockJobFindFirst = mock.fn() as any;
const mockBrowseListingFindUnique = mock.fn() as any;
const mockSavedJobFindUnique = mock.fn() as any;
const mockSavedJobUpsert = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string, code?: string) {
  const error = new Error(message) as Error & { statusCode: number; code?: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

class MockApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            const code = (error as { code?: string }).code;
            return Response.json({ error: message, ...(code && { code }) }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    ApiError: MockApiError,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: {
        findFirst: mockEnrollmentFindFirst,
      },
      jobListing: {
        findFirst: mockJobFindFirst,
      },
      jobBrowseListing: {
        findUnique: mockBrowseListingFindUnique,
      },
      studentSavedJob: {
        findUnique: mockSavedJobFindUnique,
        upsert: mockSavedJobUpsert,
      },
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("POST /api/jobs/save", () => {
  beforeEach(() => {
    mockEnrollmentFindFirst.mock.resetCalls();
    mockJobFindFirst.mock.resetCalls();
    mockBrowseListingFindUnique.mock.resetCalls();
    mockSavedJobFindUnique.mock.resetCalls();
    mockSavedJobUpsert.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
    mockJobFindFirst.mock.mockImplementation(async () => ({ id: "job-1", title: "Office Assistant" }));
    mockBrowseListingFindUnique.mock.mockImplementation(async () => null);
    mockSavedJobFindUnique.mock.mockImplementation(async () => null);
    mockSavedJobUpsert.mock.mockImplementation(async (args: any) => ({
      id: "saved-1",
      studentId: session.id,
      jobListingId: args.create.jobListingId,
      status: args.create.status,
      notes: args.create.notes,
      appliedAt: args.create.appliedAt,
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  for (const status of ["applied", "interviewing", "offered"] as const) {
    it(`sets appliedAt when the student first moves a job to ${status}`, async () => {
      const req = mockRequest("/api/jobs/save", {
        method: "POST",
        body: {
          jobListingId: "cjld2cyuq0000t3t37ch82xgg",
          status,
          notes: "Applied through employer site",
        },
      });

      const res = await route.POST(req as never);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(mockJobFindFirst.mock.calls[0]?.arguments[0].where.classConfig.classId, "class-1");
      assert.equal(mockSavedJobUpsert.mock.callCount(), 1);
      assert.ok(mockSavedJobUpsert.mock.calls[0]?.arguments[0].create.appliedAt instanceof Date);
      assert.ok(body.savedJob.appliedAt);
    });
  }

  it("does not overwrite an existing appliedAt timestamp on later status changes", async () => {
    const existingAppliedAt = new Date("2026-05-01T12:00:00.000Z");
    mockSavedJobFindUnique.mock.mockImplementationOnce(async () => ({ appliedAt: existingAppliedAt }));

    const req = mockRequest("/api/jobs/save", {
      method: "POST",
      body: { jobListingId: "cjld2cyuq0000t3t37ch82xgg", status: "interviewing" },
    });

    const res = await route.POST(req as never);

    assert.equal(res.status, 200);
    assert.equal(mockSavedJobUpsert.mock.calls[0]?.arguments[0].update.appliedAt, undefined);
  });

  it("rejects jobs outside the student's active class with a generic message when the id matches nothing", async () => {
    mockJobFindFirst.mock.mockImplementationOnce(async () => null);
    mockBrowseListingFindUnique.mock.mockImplementationOnce(async () => null);

    const req = mockRequest("/api/jobs/save", {
      method: "POST",
      body: { jobListingId: "cjld2cyuq0099t3t37ch82xgz", status: "saved" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(String(body.error), /not found/i);
    assert.equal(body.code, undefined);
    assert.equal(mockSavedJobUpsert.mock.callCount(), 0);
  });

  // VQ-R-016: a silent save failure. An enrolled student's Save tap on a
  // JobBrowseListing row (or any job outside their class board) used to hit
  // the exact same bare 400 as a genuinely bad id, so the client — which
  // ignored `!res.ok` entirely — did nothing and the student never knew why.
  it("returns a distinct not_your_class_board code when the id is a browse-pool job outside the class board", async () => {
    mockJobFindFirst.mock.mockImplementationOnce(async () => null);
    mockBrowseListingFindUnique.mock.mockImplementationOnce(async () => ({ id: "browse-1" }));

    const req = mockRequest("/api/jobs/save", {
      method: "POST",
      body: { jobListingId: "cjld2cyuq0000browse00001", status: "saved" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.code, "not_your_class_board");
    assert.match(String(body.error), /class's board/i);
    assert.equal(mockSavedJobUpsert.mock.callCount(), 0);
  });

  it("returns the same not_your_class_board code for an unenrolled/browse-mode student saving a browse-pool job", async () => {
    mockEnrollmentFindFirst.mock.mockImplementationOnce(async () => null);
    mockBrowseListingFindUnique.mock.mockImplementationOnce(async () => ({ id: "browse-2" }));

    const req = mockRequest("/api/jobs/save", {
      method: "POST",
      body: { jobListingId: "cjld2cyuq0000browse00002", status: "saved" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.code, "not_your_class_board");
    assert.equal(mockJobFindFirst.mock.callCount(), 0, "should not query class-scoped jobListing without an enrollment");
    assert.equal(mockSavedJobUpsert.mock.callCount(), 0);
  });

  it("still gives a generic message when an unenrolled student's id matches nothing at all", async () => {
    mockEnrollmentFindFirst.mock.mockImplementationOnce(async () => null);
    mockBrowseListingFindUnique.mock.mockImplementationOnce(async () => null);

    const req = mockRequest("/api/jobs/save", {
      method: "POST",
      body: { jobListingId: "cjld2cyuq0000nowhere0001", status: "saved" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.code, undefined);
    assert.match(String(body.error), /not found|enrollment/i);
  });
});
