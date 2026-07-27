import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// =============================================================================
// VQ-R-017 — POST /api/jobs/save writes the unified Application pipeline via
// trackJobInterest (never StudentSavedJob), accepts a browse listing, and
// keeps the class-scope check on class listings.
// =============================================================================

let currentSession: Session = mockStudentSession();

const mockEnrollmentFindFirst = mock.fn<(args: unknown) => Promise<unknown>>();
const mockJobListingFindFirst = mock.fn<(args: unknown) => Promise<unknown>>();
const mockTrackJobInterest = mock.fn<(input: unknown) => Promise<unknown>>();
const mockLogAuditEvent = mock.fn<(input: Record<string, unknown>) => Promise<void>>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
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
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: {
        get findFirst() {
          return mockEnrollmentFindFirst;
        },
      },
      jobListing: {
        get findFirst() {
          return mockJobListingFindFirst;
        },
      },
    },
  },
});

mock.module("@/lib/job-applications", {
  namedExports: {
    trackJobInterest: mockTrackJobInterest,
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

const JOB_LISTING_ID = "cjld2cjxh0000qzrmn831i7rn";
const BROWSE_LISTING_ID = "cjld2cyuq0000t3rmniod1foy";

function saveRequest(body: unknown): Request {
  return mockRequest("/api/jobs/save", { method: "POST", body }) as never;
}

describe("POST /api/jobs/save (VQ-R-017)", () => {
  beforeEach(() => {
    currentSession = mockStudentSession();
    mockEnrollmentFindFirst.mock.resetCalls();
    mockJobListingFindFirst.mock.resetCalls();
    mockTrackJobInterest.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
    mockJobListingFindFirst.mock.mockImplementation(async () => ({
      id: JOB_LISTING_ID,
      title: "Office Assistant",
    }));
    mockTrackJobInterest.mock.mockImplementation(async () => ({
      ok: true,
      application: { id: "app-1", status: "saved" },
      opportunity: { id: "opp-1", title: "Office Assistant", company: "Acme" },
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("saves a class listing through trackJobInterest and returns the application", async () => {
    const res = await route.POST(saveRequest({ jobListingId: JOB_LISTING_ID }));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.application.id, "app-1");

    assert.equal(mockTrackJobInterest.mock.callCount(), 1);
    const input = mockTrackJobInterest.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(input.studentId, currentSession.id);
    assert.deepEqual(input.source, { kind: "listing", jobListingId: JOB_LISTING_ID });
    assert.equal(input.status, "saved");
  });

  it("keeps the class-scope check: a listing outside the student's class is rejected", async () => {
    mockJobListingFindFirst.mock.mockImplementation(async () => null);

    const res = await route.POST(saveRequest({ jobListingId: JOB_LISTING_ID }));

    assert.equal(res.status, 400);
    assert.equal(mockTrackJobInterest.mock.callCount(), 0);
    // The class-scope where clause is what makes the check real.
    const where = (mockJobListingFindFirst.mock.calls[0].arguments[0] as {
      where: { classConfig: { classId: string } };
    }).where;
    assert.equal(where.classConfig.classId, "class-1");
  });

  it("saves a browse listing through trackJobInterest", async () => {
    const res = await route.POST(saveRequest({ browseListingId: BROWSE_LISTING_ID, status: "applied" }));

    assert.equal(res.status, 200);
    const input = mockTrackJobInterest.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.deepEqual(input.source, { kind: "browse", browseListingId: BROWSE_LISTING_ID });
    assert.equal(input.status, "applied");
    // Browse rows are not class rows — no class-scope lookup applies.
    assert.equal(mockJobListingFindFirst.mock.callCount(), 0);
  });

  it("rejects a body naming both ids", async () => {
    const res = await route.POST(
      saveRequest({ jobListingId: JOB_LISTING_ID, browseListingId: BROWSE_LISTING_ID }),
    );
    assert.equal(res.status, 400);
    assert.equal(mockTrackJobInterest.mock.callCount(), 0);
  });

  it("rejects a body naming neither id", async () => {
    const res = await route.POST(saveRequest({ status: "saved" }));
    assert.equal(res.status, 400);
    assert.equal(mockTrackJobInterest.mock.callCount(), 0);
  });

  it("returns 400 when the tracked listing no longer exists", async () => {
    mockTrackJobInterest.mock.mockImplementation(async () => ({
      ok: false,
      reason: "listing_not_found",
    }));

    const res = await route.POST(saveRequest({ browseListingId: BROWSE_LISTING_ID }));
    assert.equal(res.status, 400);
  });

  it("audits the save with the opportunity title", async () => {
    await route.POST(saveRequest({ jobListingId: JOB_LISTING_ID, status: "interviewing" }));

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const audit = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(audit.action, "job.save");
    assert.ok(String(audit.summary).includes("interviewing"));
  });
});

// =============================================================================
// VQ-R-016 — the save button silently failed for every browse job and every
// unenrolled student: the route required an active class enrollment even when
// the save had nothing to do with a class board. Enrollment is now required
// only to validate a class-scoped jobListingId; a browse save by an
// unenrolled student creates an Application.
// =============================================================================
describe("POST /api/jobs/save browse + unenrolled saves (VQ-R-016)", () => {
  beforeEach(() => {
    currentSession = mockStudentSession();
    mockEnrollmentFindFirst.mock.resetCalls();
    mockJobListingFindFirst.mock.resetCalls();
    mockTrackJobInterest.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    // No active enrollment at all.
    mockEnrollmentFindFirst.mock.mockImplementation(async () => null);
    mockJobListingFindFirst.mock.mockImplementation(async () => null);
    mockTrackJobInterest.mock.mockImplementation(async () => ({
      ok: true,
      application: { id: "app-2", status: "saved" },
      opportunity: { id: "opp-2", title: "Remote Data Entry Clerk", company: "Remotely Inc" },
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("a browse save by an unenrolled student succeeds and creates an Application", async () => {
    const res = await route.POST(saveRequest({ browseListingId: BROWSE_LISTING_ID }));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.application.id, "app-2");
    assert.equal(mockTrackJobInterest.mock.callCount(), 1);
    const input = mockTrackJobInterest.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.deepEqual(input.source, { kind: "browse", browseListingId: BROWSE_LISTING_ID });
  });

  it("a class-listing save still requires an active enrollment", async () => {
    const res = await route.POST(saveRequest({ jobListingId: JOB_LISTING_ID }));

    assert.equal(res.status, 400);
    assert.equal(mockTrackJobInterest.mock.callCount(), 0);
  });

  it("a class-listing id outside the student's class is still rejected when enrolled", async () => {
    mockEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
    mockJobListingFindFirst.mock.mockImplementation(async () => null);

    const res = await route.POST(saveRequest({ jobListingId: JOB_LISTING_ID }));

    assert.equal(res.status, 400);
    assert.equal(mockTrackJobInterest.mock.callCount(), 0);
  });
});
