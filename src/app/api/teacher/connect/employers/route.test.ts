/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

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
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
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

  it("never leaks a raw Prisma error to the client", async () => {
    mockUpdate.mock.mockImplementationOnce(async () => {
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
