/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { Prisma } from "@prisma/client";

import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/** The real Prisma error class, so `instanceof` in the lib actually matches. */
const PrismaKnownError = Prisma.PrismaClientKnownRequestError;

/**
 * /api/teacher/connect/employers — the employer directory's read and write
 * surface (Match & Connect Task 3.2).
 *
 * Three things are asserted here that a reviewer cannot read off the diff:
 * a non-staff session is refused before any query runs, an invalid body is a
 * 400 rather than a partially-written row, and every write leaves an audit
 * entry. Employer rows carry a named person's workplace, so "who changed
 * this" is not optional.
 */

const session = mockTeacherSession();
let currentRole = "teacher";

const mockCreate = mock.fn(async (args: any) => ({ id: "emp-new", ...args.data })) as any;
const mockUpdate = mock.fn(async (args: any) => ({ id: args.where.id, ...args.data })) as any;
const mockFindMany = mock.fn(async () => [
  { id: "emp-1", name: "Mountain Metal", status: "active" },
]) as any;
const mockLeadUpdateMany = mock.fn(async () => ({ count: 0 })) as any;
const mockStudentFindUnique = mock.fn(async () => ({ role: "teacher" })) as any;
// updateEmployer batches its three writes; the mock runs them and hands back
// the array Prisma would, so the route's `const [employer] = ...` still works.
const mockTransaction = mock.fn(async (operations: Promise<unknown>[]) =>
  Promise.all(operations),
) as any;
const mockLogAuditEvent = mock.fn(async () => {}) as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        if (currentRole !== "teacher" && currentRole !== "admin") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        try {
          return await handler({ ...session, role: currentRole }, ...args);
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
    notFound: (message: string) => makeHttpError(404, message),
    conflict: (message: string) => makeHttpError(409, message),
    ApiError: class ApiError extends Error {
      constructor(
        public readonly statusCode: number,
        message: string,
      ) {
        super(message);
      }
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      get $transaction() {
        return mockTransaction;
      },
      employer: {
        get create() {
          return mockCreate;
        },
        get update() {
          return mockUpdate;
        },
        get findMany() {
          return mockFindMany;
        },
      },
      jobLead: {
        get updateMany() {
          return mockLeadUpdateMany;
        },
      },
      student: {
        get findUnique() {
          return mockStudentFindUnique;
        },
      },
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    get logAuditEvent() {
      return mockLogAuditEvent;
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  currentRole = "teacher";
  mockCreate.mock.resetCalls();
  mockUpdate.mock.resetCalls();
  mockFindMany.mock.resetCalls();
  mockLeadUpdateMany.mock.resetCalls();
  mockStudentFindUnique.mock.resetCalls();
  mockTransaction.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
});

const validEmployer = {
  name: "Mountain Metal",
  county: "Raleigh",
  city: "Beckley",
};

describe("GET /api/teacher/connect/employers", () => {
  it("refuses a student session before touching the database", async () => {
    currentRole = "student";
    const response = await route.GET(mockRequest("/api/teacher/connect/employers"));
    assert.equal(response.status, 403);
    assert.equal(mockFindMany.mock.callCount(), 0);
  });

  it("returns the directory for staff", async () => {
    const response = await route.GET(mockRequest("/api/teacher/connect/employers"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.employers[0].name, "Mountain Metal");
  });

  it("rejects a misspelled filter instead of widening the result set", async () => {
    // `?status=oepn` used to fall back to {} and return EVERY employer,
    // including the do_not_contact ones the caller was trying to exclude.
    const response = await route.GET(
      mockRequest("/api/teacher/connect/employers", { searchParams: { status: "oepn" } }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockFindMany.mock.callCount(), 0);
  });
});

describe("POST /api/teacher/connect/employers", () => {
  it("refuses a student session", async () => {
    currentRole = "student";
    const response = await route.POST(
      mockRequest("/api/teacher/connect/employers", { method: "POST", body: validEmployer }),
    );
    assert.equal(response.status, 403);
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("rejects a body with no name and writes nothing", async () => {
    const response = await route.POST(
      mockRequest("/api/teacher/connect/employers", {
        method: "POST",
        body: { county: "Raleigh", city: "Beckley" },
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });

  it("rejects an unknown field rather than silently dropping it", async () => {
    const response = await route.POST(
      mockRequest("/api/teacher/connect/employers", {
        method: "POST",
        body: { ...validEmployer, hiredSpokesGradBefore: true },
      }),
    );
    assert.equal(response.status, 400, "hire history is derived, never client-set");
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("creates the employer and derives its dedupe key from the name", async () => {
    const response = await route.POST(
      mockRequest("/api/teacher/connect/employers", {
        method: "POST",
        body: { ...validEmployer, name: "  Mountain   Metal " },
      }),
    );
    assert.equal(response.status, 200);
    const args = mockCreate.mock.calls[0].arguments[0];
    assert.equal(args.data.nameKey, "mountain metal");
  });

  it("refuses a relationship owner who is not staff", async () => {
    // relationshipOwnerId is a foreign key to Student, which is where students
    // live too — without the role check a student could be named as the owner
    // of an employer relationship and printed in the directory.
    mockStudentFindUnique.mock.mockImplementationOnce(async () => ({ role: "student" }));
    const response = await route.POST(
      mockRequest("/api/teacher/connect/employers", {
        method: "POST",
        body: { ...validEmployer, relationshipOwnerId: "clh0000000000000000000001" },
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("answers a duplicate name with 409, not a 500", async () => {
    const conflictError = Object.assign(
      new Error("Unique constraint failed on the fields: (`nameKey`)"),
      { code: "P2002", name: "PrismaClientKnownRequestError" },
    );
    Object.setPrototypeOf(conflictError, PrismaKnownError.prototype);
    mockCreate.mock.mockImplementationOnce(async () => {
      throw conflictError;
    });
    const response = await route.POST(
      mockRequest("/api/teacher/connect/employers", { method: "POST", body: validEmployer }),
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.ok(body.error.includes("already an employer with that name"), body.error);
    assert.ok(!body.error.includes("nameKey"), "no constraint name reaches the client");
  });

  it("audits the create with the actor and the employer id", async () => {
    await route.POST(
      mockRequest("/api/teacher/connect/employers", { method: "POST", body: validEmployer }),
    );
    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const entry = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(entry.action, "connect.employer.created");
    assert.equal(entry.actorId, session.id);
    assert.equal(entry.targetType, "employer");
    assert.equal(entry.targetId, "emp-new");
  });
});

describe("PUT /api/teacher/connect/employers", () => {
  it("requires an id", async () => {
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/employers", { method: "PUT", body: { name: "New Name" } }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("audits the update", async () => {
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/employers", {
        method: "PUT",
        body: { id: "clh0000000000000000000000", status: "do_not_contact" },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(mockLogAuditEvent.mock.calls[0].arguments[0].action, "connect.employer.updated");
  });

  it("pauses the employer's open leads when they are marked do not contact", async () => {
    // The student path filters on the LEAD's status because it cannot read
    // Employer at all. Without this, an employer could be do-not-contact while
    // their openings kept being offered to students.
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/employers", {
        method: "PUT",
        body: { id: "clh0000000000000000000000", status: "do_not_contact" },
      }),
    );
    assert.equal(response.status, 200);
    const call = mockLeadUpdateMany.mock.calls.at(-1)?.arguments[0];
    assert.deepEqual(call.where, { employerId: "clh0000000000000000000000", status: "open" });
    assert.equal(call.data.status, "paused");
    assert.ok(call.data.pausedReason.length > 0, "an instructor must be told why");
  });

  it("re-syncs the denormalised employerName on every lead when renamed", async () => {
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/employers", {
        method: "PUT",
        body: { id: "clh0000000000000000000000", name: "Mountain Metal Works" },
      }),
    );
    assert.equal(response.status, 200);
    const call = mockLeadUpdateMany.mock.calls.at(-1)?.arguments[0];
    assert.deepEqual(call.where, { employerId: "clh0000000000000000000000" });
    assert.equal(
      call.data.employerName,
      "Mountain Metal Works",
      "a stale copy would show students the old name forever",
    );
  });

  it("does all three writes in one transaction", async () => {
    await route.PUT(
      mockRequest("/api/teacher/connect/employers", {
        method: "PUT",
        body: { id: "clh0000000000000000000000", name: "Renamed", status: "do_not_contact" },
      }),
    );
    assert.equal(mockTransaction.mock.callCount(), 1);
    assert.equal(
      mockTransaction.mock.calls[0].arguments[0].length,
      3,
      "the update plus both corrections must land together or not at all",
    );
  });

  it("never leaks a raw Prisma error to the client", async () => {
    mockTransaction.mock.mockImplementationOnce(async () => {
      throw new Error(
        "Invalid `prisma.employer.update()` invocation: record not found in visionquest.Employer",
      );
    });
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/employers", {
        method: "PUT",
        body: { id: "clh0000000000000000000000", status: "paused" },
      }),
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(!body.error.includes("prisma"), body.error);
    assert.ok(!body.error.includes("visionquest"), body.error);
  });
});
