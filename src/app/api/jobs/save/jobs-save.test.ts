/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockAdminSession, mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

const session = mockStudentSession();
const STAFF_SESSIONS = [
  mockTeacherSession(),
  mockTeacherSession({ role: "coordinator" }),
  mockAdminSession(),
];
// Fix round 1: the route under test reads this, so a case can act as staff.
let currentSession = session;

const mockEnrollmentFindMany = mock.fn() as any;
const mockJobFindFirst = mock.fn() as any;
const mockBrowseListingFindUnique = mock.fn() as any;
const mockSavedJobFindMany = mock.fn() as any;
const mockSavedJobCreate = mock.fn() as any;
const mockSavedJobUpdate = mock.fn() as any;
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
          return await handler(currentSession, ...args);
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
    // S3: the real factory (src/lib/api-error.ts:49-51) stamps "BAD_REQUEST",
    // not an absent code — the mock must match so a test asserting on
    // `body.code` sees what production actually sends.
    badRequest: (message: string) => makeHttpError(400, message, "BAD_REQUEST"),
    forbidden: (message = "Forbidden") => makeHttpError(403, message, "FORBIDDEN"),
    ApiError: MockApiError,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findMany: mockEnrollmentFindMany },
      jobListing: { findFirst: mockJobFindFirst },
      studentSavedJob: {
        findMany: mockSavedJobFindMany,
        create: mockSavedJobCreate,
        update: mockSavedJobUpdate,
      },
    },
    // JobBrowseListing is a program-wide pool with no per-student ownership,
    // read through prismaAdmin rather than the RLS-scoped app client.
    prismaAdmin: {
      jobBrowseListing: { findUnique: mockBrowseListingFindUnique },
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

const CLASS_ID = "cjld2cyuq0000t3t37ch82xgg";
const BROWSE_ID = "cjld2cyuq0000browse00001";

const classListing = {
  id: CLASS_ID,
  title: "Office Assistant",
  company: "Valley Health",
  location: "Charleston, WV",
  url: "https://example.com/jobs/office",
  source: "adzuna",
  sourceId: "adzuna:111",
  expiresAt: null,
};

const browseListing = {
  id: BROWSE_ID,
  title: "Remote Data Entry Clerk",
  company: "Remotely Inc",
  location: "Remote",
  url: "https://example.com/browse/1",
  source: "remotive",
  sourceId: "remotive:9",
  postedAt: new Date("2026-11-01T00:00:00Z"),
  expiresAt: new Date("2026-12-01T00:00:00Z"),
};

function post(body: Record<string, unknown>) {
  return route.POST(mockRequest("/api/jobs/save", { method: "POST", body }) as never);
}

describe("POST /api/jobs/save", () => {
  beforeEach(() => {
    currentSession = session;
    for (const fn of [
      mockEnrollmentFindMany,
      mockJobFindFirst,
      mockBrowseListingFindUnique,
      mockSavedJobFindMany,
      mockSavedJobCreate,
      mockSavedJobUpdate,
      mockLogAuditEvent,
    ]) {
      fn.mock.resetCalls();
    }
    mockEnrollmentFindMany.mock.mockImplementation(async () => [{ classId: "class-1" }]);
    mockJobFindFirst.mock.mockImplementation(async () => classListing);
    mockBrowseListingFindUnique.mock.mockImplementation(async () => null);
    mockSavedJobFindMany.mock.mockImplementation(async () => []);
    mockSavedJobCreate.mock.mockImplementation(async (args: any) => ({ id: "saved-1", ...args.data }));
    mockSavedJobUpdate.mock.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  for (const status of ["applied", "interviewing", "offered"] as const) {
    it(`sets appliedAt when the student first moves a job to ${status}`, async () => {
      const res = await post({ jobListingId: CLASS_ID, status, notes: "Applied through employer site" });
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(mockSavedJobCreate.mock.callCount(), 1);
      assert.ok(mockSavedJobCreate.mock.calls[0]?.arguments[0].data.appliedAt instanceof Date);
      assert.ok(body.savedJob.appliedAt);
    });
  }

  it("does not overwrite an existing appliedAt timestamp on later status changes", async () => {
    mockSavedJobFindMany.mock.mockImplementationOnce(async () => [
      { id: "saved-1", vacancyKey: "v1:adzuna:adzuna:111", jobListingId: CLASS_ID, jobBrowseListingId: null, appliedAt: new Date("2026-05-01T12:00:00.000Z") },
    ]);

    const res = await post({ jobListingId: CLASS_ID, status: "interviewing" });

    assert.equal(res.status, 200);
    assert.equal(mockSavedJobCreate.mock.callCount(), 0);
    assert.equal(mockSavedJobUpdate.mock.calls[0]?.arguments[0].data.appliedAt, undefined);
  });

  it("checks the listing against every active class, not only the first", async () => {
    mockEnrollmentFindMany.mock.mockImplementationOnce(async () => [{ classId: "class-1" }, { classId: "class-2" }]);

    const res = await post({ jobListingId: CLASS_ID });

    assert.equal(res.status, 200);
    const where = mockJobFindFirst.mock.calls[0]?.arguments[0].where;
    assert.deepEqual(where.classConfig, { classId: { in: ["class-1", "class-2"] } });
    assert.deepEqual(mockEnrollmentFindMany.mock.calls[0]?.arguments[0].where, { studentId: session.id, status: "active" });
  });

  it("stores the vacancy key, the snapshot and where the save came from", async () => {
    await post({ jobListingId: CLASS_ID });

    const data = mockSavedJobCreate.mock.calls[0]?.arguments[0].data;
    assert.equal(data.studentId, session.id);
    assert.equal(data.jobListingId, CLASS_ID);
    assert.equal(data.listingKind, "class");
    assert.equal(data.vacancyKey, "v1:adzuna:adzuna:111");
    assert.equal(data.snapshotTitle, "Office Assistant");
    assert.equal(data.snapshotUrl, "https://example.com/jobs/office");
    assert.ok(data.snapshotAt instanceof Date);
  });

  it("saves a browse-pool job for a student with no class", async () => {
    mockEnrollmentFindMany.mock.mockImplementationOnce(async () => []);
    mockBrowseListingFindUnique.mock.mockImplementationOnce(async () => browseListing);

    const res = await post({ jobListingId: BROWSE_ID, status: "saved" });

    assert.equal(res.status, 200);
    assert.equal(mockJobFindFirst.mock.callCount(), 0, "no class-scoped query without an enrollment");
    const data = mockSavedJobCreate.mock.calls[0]?.arguments[0].data;
    assert.equal(data.jobBrowseListingId, BROWSE_ID);
    assert.equal(data.jobListingId, undefined);
    assert.equal(data.listingKind, "browse");
    assert.equal(data.vacancyKey, "v1:remotive:remotive:9");
    assert.deepEqual(data.snapshotPostedAt, browseListing.postedAt);
    assert.equal(mockLogAuditEvent.mock.calls[0]?.arguments[0].targetType, "JobBrowseListing");
  });

  it("saves a browse-pool job for an enrolled student when it is not on the class board", async () => {
    mockJobFindFirst.mock.mockImplementationOnce(async () => null);
    mockBrowseListingFindUnique.mock.mockImplementationOnce(async () => browseListing);

    const res = await post({ jobListingId: BROWSE_ID });

    assert.equal(res.status, 200);
    assert.equal(mockSavedJobCreate.mock.calls[0]?.arguments[0].data.listingKind, "browse");
  });

  it("updates the student's existing save for the same vacancy after a reimport", async () => {
    mockSavedJobFindMany.mock.mockImplementationOnce(async () => [
      { id: "saved-old", vacancyKey: "v1:adzuna:adzuna:111", jobListingId: null, jobBrowseListingId: null, appliedAt: null },
    ]);

    await post({ jobListingId: CLASS_ID, status: "saved" });

    const lookup = mockSavedJobFindMany.mock.calls[0]?.arguments[0].where;
    assert.equal(lookup.studentId, session.id);
    assert.deepEqual(lookup.OR, [{ vacancyKey: "v1:adzuna:adzuna:111" }, { jobListingId: CLASS_ID }]);
    const update = mockSavedJobUpdate.mock.calls[0]?.arguments[0];
    assert.equal(update.where.id, "saved-old");
    assert.equal(update.data.jobListingId, CLASS_ID);
    assert.equal(update.data.notes, undefined, "notes stay when the request sends none");
    assert.equal(mockSavedJobCreate.mock.callCount(), 0);
  });

  it("keeps a legacy row's link when a keyed row for the vacancy also exists", async () => {
    mockSavedJobFindMany.mock.mockImplementationOnce(async () => [
      { id: "legacy", vacancyKey: null, jobListingId: CLASS_ID, jobBrowseListingId: null, appliedAt: null },
      { id: "keyed", vacancyKey: "v1:adzuna:adzuna:111", jobListingId: null, jobBrowseListingId: null, appliedAt: null },
    ]);

    await post({ jobListingId: CLASS_ID, notes: "Call Monday" });

    const update = mockSavedJobUpdate.mock.calls[0]?.arguments[0];
    assert.equal(update.where.id, "keyed");
    assert.equal("jobListingId" in update.data, false, "the link already belongs to the legacy row");
    assert.equal(update.data.notes, "Call Monday");
  });

  it("rejects an id that matches no listing the student can see", async () => {
    mockJobFindFirst.mock.mockImplementationOnce(async () => null);

    const res = await post({ jobListingId: "cjld2cyuq0099t3t37ch82xgz", status: "saved" });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(String(body.error), /not found/i);
    assert.equal(mockSavedJobCreate.mock.callCount(), 0);
    assert.equal(mockSavedJobUpdate.mock.callCount(), 0);
  });

  it("rejects a listing without a usable source id", async () => {
    mockJobFindFirst.mock.mockImplementationOnce(async () => ({ ...classListing, sourceId: " " }));

    const res = await post({ jobListingId: CLASS_ID });

    assert.equal(res.status, 400);
    assert.equal(mockSavedJobCreate.mock.callCount(), 0);
  });

  for (const staff of STAFF_SESSIONS) {
    it(`refuses a ${staff.role} session with 403 and writes nothing`, async () => {
      currentSession = staff;
      mockBrowseListingFindUnique.mock.mockImplementation(async () => browseListing);

      const res = await post({ jobListingId: BROWSE_ID });

      assert.equal(res.status, 403);
      assert.equal(mockSavedJobCreate.mock.callCount(), 0);
      assert.equal(mockSavedJobUpdate.mock.callCount(), 0);
      assert.equal(mockLogAuditEvent.mock.callCount(), 0);
    });
  }

  it("rejects an id that is not a cuid", async () => {
    const res = await post({ jobListingId: "not-a-cuid" });
    assert.equal(res.status, 400);
    assert.equal(mockJobFindFirst.mock.callCount(), 0);
  });
});
