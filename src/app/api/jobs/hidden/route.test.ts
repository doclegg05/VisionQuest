/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const session = mockStudentSession();

const mockEnrollmentFindMany = mock.fn() as any;
const mockJobFindFirst = mock.fn() as any;
const mockBrowseFindUnique = mock.fn() as any;
const mockHiddenUpsert = mock.fn() as any;
const mockHiddenFindFirst = mock.fn() as any;
const mockHiddenUpdate = mock.fn() as any;
const mockHiddenFindMany = mock.fn() as any;
const mockConfigFindUnique = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

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
          if (error instanceof MockApiError) {
            return Response.json(
              { error: error.message, ...(error.code && { code: error.code }) },
              { status: error.statusCode },
            );
          }
          throw error;
        }
      },
    badRequest: (message: string) => new MockApiError(400, message, "BAD_REQUEST"),
    ApiError: MockApiError,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findMany: mockEnrollmentFindMany },
      jobListing: { findFirst: mockJobFindFirst },
      studentHiddenJob: {
        upsert: mockHiddenUpsert,
        findFirst: mockHiddenFindFirst,
        update: mockHiddenUpdate,
        findMany: mockHiddenFindMany,
      },
    },
    prismaAdmin: {
      jobBrowseListing: { findUnique: mockBrowseFindUnique },
      systemConfig: { findUnique: mockConfigFindUnique },
    },
  },
});

// The real cache would keep the first flag read for 60 seconds across tests.
mock.module("@/lib/cache", {
  namedExports: {
    cached: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    invalidatePrefix: () => undefined,
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

const LISTING_ID = "cjld2cyuq0000t3t37ch82xgg";
const HIDDEN_ID = "cjld2cyuq0000hidden00001";

const classListing = {
  id: LISTING_ID,
  title: "Cashier",
  company: "Kroger",
  location: "Charleston, WV",
  url: "https://example.com/a",
  source: "adzuna",
  sourceId: "adzuna:111",
  expiresAt: null,
};

function post(body: Record<string, unknown>) {
  return route.POST(mockRequest("/api/jobs/hidden", { method: "POST", body }) as never);
}

describe("/api/jobs/hidden", () => {
  beforeEach(() => {
    for (const fn of [
      mockEnrollmentFindMany,
      mockJobFindFirst,
      mockBrowseFindUnique,
      mockHiddenUpsert,
      mockHiddenFindFirst,
      mockHiddenUpdate,
      mockHiddenFindMany,
      mockConfigFindUnique,
      mockLogAuditEvent,
    ]) {
      fn.mock.resetCalls();
    }
    mockEnrollmentFindMany.mock.mockImplementation(async () => [{ classId: "class-1" }]);
    mockJobFindFirst.mock.mockImplementation(async () => classListing);
    mockBrowseFindUnique.mock.mockImplementation(async () => null);
    mockHiddenUpsert.mock.mockImplementation(async (args: any) => ({ id: HIDDEN_ID, ...args.create }));
    mockHiddenFindFirst.mock.mockImplementation(async () => ({ id: HIDDEN_ID }));
    mockHiddenUpdate.mock.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }));
    mockHiddenFindMany.mock.mockImplementation(async () => []);
    mockConfigFindUnique.mock.mockImplementation(async () => null);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("hides a vacancy for this student only, keyed by source and source id", async () => {
    const res = await post({ action: "hide", jobListingId: LISTING_ID });
    const body = await res.json();

    assert.equal(res.status, 200);
    const args = mockHiddenUpsert.mock.calls[0]?.arguments[0];
    assert.deepEqual(args.where, {
      studentId_vacancyKey: { studentId: session.id, vacancyKey: "v1:adzuna:adzuna:111" },
    });
    assert.equal(args.create.studentId, session.id);
    assert.equal(args.create.snapshotTitle, "Cashier");
    assert.equal(args.update.restoredAt, null, "hiding again reopens a restored row");
    assert.equal(body.hiddenJob.id, HIDDEN_ID);
    assert.equal(mockLogAuditEvent.mock.calls[0]?.arguments[0].action, "job.hide");
  });

  it("hides a browse-pool job", async () => {
    mockEnrollmentFindMany.mock.mockImplementationOnce(async () => []);
    mockBrowseFindUnique.mock.mockImplementationOnce(async () => ({
      ...classListing,
      source: "remotive",
      sourceId: "remotive:9",
      postedAt: null,
    }));

    const res = await post({ action: "hide", jobListingId: LISTING_ID });

    assert.equal(res.status, 200);
    assert.equal(
      mockHiddenUpsert.mock.calls[0]?.arguments[0].where.studentId_vacancyKey.vacancyKey,
      "v1:remotive:remotive:9",
    );
  });

  it("refuses to hide a listing the student cannot see", async () => {
    mockJobFindFirst.mock.mockImplementationOnce(async () => null);

    const res = await post({ action: "hide", jobListingId: LISTING_ID });

    assert.equal(res.status, 400);
    assert.equal(mockHiddenUpsert.mock.callCount(), 0);
  });

  it("restores a hidden row the student owns, keeping it as history", async () => {
    const res = await post({ action: "restore", hiddenJobId: HIDDEN_ID });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(mockHiddenFindFirst.mock.calls[0]?.arguments[0].where, {
      id: HIDDEN_ID,
      studentId: session.id,
      restoredAt: null,
    });
    const update = mockHiddenUpdate.mock.calls[0]?.arguments[0];
    assert.equal(update.where.id, HIDDEN_ID);
    assert.ok(update.data.restoredAt instanceof Date);
    assert.ok(body.hiddenJob.restoredAt);
    assert.equal(mockLogAuditEvent.mock.calls[0]?.arguments[0].action, "job.restore");
  });

  it("answers 404 when the hidden row is not the student's", async () => {
    mockHiddenFindFirst.mock.mockImplementationOnce(async () => null);

    const res = await post({ action: "restore", hiddenJobId: HIDDEN_ID });

    assert.equal(res.status, 404);
    assert.equal(mockHiddenUpdate.mock.callCount(), 0);
  });

  it("validates ids as cuids", async () => {
    const hide = await post({ action: "hide", jobListingId: "nope" });
    const restore = await post({ action: "restore", hiddenJobId: "nope" });
    const unknown = await post({ action: "delete", hiddenJobId: HIDDEN_ID });

    assert.equal(hide.status, 400);
    assert.equal(restore.status, 400);
    assert.equal(unknown.status, 400);
    assert.equal(mockHiddenUpsert.mock.callCount(), 0);
    assert.equal(mockHiddenUpdate.mock.callCount(), 0);
  });

  it("lists the student's hidden jobs with the feature on", async () => {
    mockHiddenFindMany.mock.mockImplementationOnce(async () => [
      { id: HIDDEN_ID, snapshotTitle: "Cashier", snapshotCompany: "Kroger", snapshotLocation: "Charleston, WV", hiddenAt: new Date() },
    ]);

    const res = await route.GET();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.hideEnabled, true);
    assert.equal(body.hiddenJobs.length, 1);
    assert.deepEqual(mockHiddenFindMany.mock.calls[0]?.arguments[0].where, {
      studentId: session.id,
      restoredAt: null,
    });
  });

  it("turns hide and restore off with job_hide_enabled = off, keeping stored rows", async () => {
    mockConfigFindUnique.mock.mockImplementation(async () => ({ value: "off" }));

    const list = await (await route.GET()).json();
    const hide = await post({ action: "hide", jobListingId: LISTING_ID });
    const restore = await post({ action: "restore", hiddenJobId: HIDDEN_ID });

    assert.deepEqual(list, { hideEnabled: false, hiddenJobs: [] });
    assert.equal(hide.status, 404);
    assert.equal((await hide.json()).code, "job_hide_disabled");
    assert.equal(restore.status, 404);
    assert.equal(mockHiddenUpsert.mock.callCount(), 0);
    assert.equal(mockHiddenUpdate.mock.callCount(), 0);
    assert.equal(mockHiddenFindMany.mock.callCount(), 0);
  });
});
