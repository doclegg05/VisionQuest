/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/**
 * /api/teacher/connect/leads — the leads board's read and write surface
 * (Match & Connect Task 3.2).
 *
 * Beyond auth, validation and auditing, two rules are pinned here because
 * they are provenance rules and a future edit could quietly relax them:
 * a hand-typed lead may never claim `source: "joblisting"` or `"opportunity"`
 * (those carry a sourceRef only the server sets), and the board's fit counts
 * are aggregates — the response must never carry a student name or id.
 */

const session = mockTeacherSession();
let currentRole = "teacher";

const EMPLOYER_ID = "clh0000000000000000000001";
const CLASS_ID = "clh0000000000000000000cls";
const CONTACT_ID = "clh0000000000000000000con";

const leadRow = {
  id: "lead-1",
  title: "Production Associate",
  employerId: "emp-1",
  classId: null,
  source: "manual",
  status: "open",
  employer: { id: "emp-1", name: "Mountain Metal" },
};

const mockLeadCreate = mock.fn(async (args: any) => ({ ...leadRow, ...args.data })) as any;
const mockLeadUpdate = mock.fn(async (args: any) => ({ ...leadRow, ...args.data })) as any;
const allLeads = [leadRow, { ...leadRow, id: "lead-2", status: "closed" }];
// Honours `where.id.in` so summarizeLeadFits only sees the ids the route
// actually asked for — the whole point of the open-only assertion below.
const mockLeadFindMany = mock.fn(async (args: any) => {
  const ids = args?.where?.id?.in as string[] | undefined;
  return ids ? allLeads.filter((lead) => ids.includes(lead.id)) : allLeads;
}) as any;
const mockEnrollmentFindMany = mock.fn(async () => []) as any;
const mockLeadFindUnique = mock.fn(async () => ({ id: "lead-1", employerId: EMPLOYER_ID })) as any;
const mockEmployerFindUnique = mock.fn(async () => ({
  id: EMPLOYER_ID,
  name: "Mountain Metal",
})) as any;
const mockClassFindUnique = mock.fn(async () => ({ id: CLASS_ID })) as any;
const mockContactFindFirst = mock.fn(async () => ({ id: CONTACT_ID })) as any;
const mockWorkProfileFindMany = mock.fn(async () => []) as any;
const mockApplicationFindMany = mock.fn(async () => []) as any;
const mockLogAuditEvent = mock.fn(async () => {}) as any;

/**
 * A real class, because the routes now use `error instanceof ApiError` to let
 * a lib's own 404 ("that class isn't yours") through instead of flattening it.
 */
class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function makeHttpError(statusCode: number, message: string) {
  return new HttpError(statusCode, message);
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
    ApiError: HttpError,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobLead: {
        get create() {
          return mockLeadCreate;
        },
        get update() {
          return mockLeadUpdate;
        },
        get findMany() {
          return mockLeadFindMany;
        },
        get findUnique() {
          return mockLeadFindUnique;
        },
      },
      employer: {
        get findUnique() {
          return mockEmployerFindUnique;
        },
      },
      spokesClass: {
        get findUnique() {
          return mockClassFindUnique;
        },
      },
      employerContact: {
        get findFirst() {
          return mockContactFindFirst;
        },
      },
      studentClassEnrollment: {
        get findMany() {
          return mockEnrollmentFindMany;
        },
      },
      studentWorkProfile: {
        get findMany() {
          return mockWorkProfileFindMany;
        },
      },
      application: {
        get findMany() {
          return mockApplicationFindMany;
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
  mockLeadCreate.mock.resetCalls();
  mockLeadUpdate.mock.resetCalls();
  mockLeadFindMany.mock.resetCalls();
  mockLeadFindUnique.mock.resetCalls();
  mockEmployerFindUnique.mock.resetCalls();
  mockClassFindUnique.mock.resetCalls();
  mockContactFindFirst.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
});

const validLead = {
  employerId: EMPLOYER_ID,
  title: "Production Associate",
  location: "Beckley, WV",
};

describe("GET /api/teacher/connect/leads", () => {
  it("refuses a student session before touching the database", async () => {
    currentRole = "student";
    const response = await route.GET(mockRequest("/api/teacher/connect/leads"));
    assert.equal(response.status, 403);
    assert.equal(mockLeadFindMany.mock.callCount(), 0);
  });

  it("rejects a misspelled status filter instead of returning every lead", async () => {
    const response = await route.GET(
      mockRequest("/api/teacher/connect/leads", { searchParams: { status: "oepn" } }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockLeadFindMany.mock.callCount(), 0);
  });

  it("returns leads without fit counts by default", async () => {
    const response = await route.GET(mockRequest("/api/teacher/connect/leads"));
    const body = await response.json();
    assert.equal(body.leads.length, 2);
    assert.equal(body.leads[0].fitCount, undefined);
    assert.equal(mockEnrollmentFindMany.mock.callCount(), 0, "no roster load without ?fitCounts=1");
  });

  it("adds fit counts on request, and only for open leads", async () => {
    const response = await route.GET(
      mockRequest("/api/teacher/connect/leads", { searchParams: { fitCounts: "1" } }),
    );
    const body = await response.json();
    const open = body.leads.find((lead: any) => lead.id === "lead-1");
    const closed = body.leads.find((lead: any) => lead.id === "lead-2");
    assert.equal(open.fitCount, 0, "empty roster in this fixture, but the field is present");
    assert.equal(closed.fitCount, null, "a closed lead blocks everyone; the count means nothing");
  });

  it("returns aggregate counts only — never a student name or id", async () => {
    const response = await route.GET(
      mockRequest("/api/teacher/connect/leads", { searchParams: { fitCounts: "1" } }),
    );
    const text = await response.text();
    assert.ok(!text.includes("studentId"), text);
    assert.ok(!text.includes("displayName"), text);
  });
});

describe("POST /api/teacher/connect/leads", () => {
  it("refuses a student session", async () => {
    currentRole = "student";
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", { method: "POST", body: validLead }),
    );
    assert.equal(response.status, 403);
    assert.equal(mockLeadCreate.mock.callCount(), 0);
  });

  it("rejects a body with no title and writes nothing", async () => {
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", {
        method: "POST",
        body: { employerId: EMPLOYER_ID, location: "Beckley, WV" },
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockLeadCreate.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });

  it("rejects a schedule naming a shift the matcher does not know", async () => {
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", {
        method: "POST",
        body: { ...validLead, schedule: { shifts: ["graveyard"] } },
      }),
    );
    assert.equal(response.status, 400);
  });

  it("rejects a pay range that runs backwards", async () => {
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", {
        method: "POST",
        body: { ...validLead, payMin: 20, payMax: 12 },
      }),
    );
    assert.equal(response.status, 400);
  });

  it("stores a hand-typed lead as source 'manual'", async () => {
    await route.POST(
      mockRequest("/api/teacher/connect/leads", { method: "POST", body: validLead }),
    );
    assert.equal(mockLeadCreate.mock.calls[0].arguments[0].data.source, "manual");
  });

  it("stores a MACC job order as source 'joborder'", async () => {
    await route.POST(
      mockRequest("/api/teacher/connect/leads", {
        method: "POST",
        body: { ...validLead, source: "joborder" },
      }),
    );
    assert.equal(mockLeadCreate.mock.calls[0].arguments[0].data.source, "joborder");
  });

  it("never lets a client claim a provenance it did not earn", async () => {
    for (const source of ["joblisting", "opportunity"]) {
      mockLeadCreate.mock.resetCalls();
      await route.POST(
        mockRequest("/api/teacher/connect/leads", {
          method: "POST",
          body: { ...validLead, source },
        }),
      );
      assert.equal(
        mockLeadCreate.mock.calls[0].arguments[0].data.source,
        "manual",
        `"${source}" carries a sourceRef only the server sets`,
      );
      assert.equal(mockLeadCreate.mock.calls[0].arguments[0].data.sourceRef, undefined);
    }
  });

  it("refuses a class the caller does not instruct", async () => {
    // job_lead_write's class clause is the floor; this is the clear message.
    // Without both, a teacher could publish a job into somebody else's room.
    mockClassFindUnique.mock.mockImplementationOnce(async () => null);
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", {
        method: "POST",
        body: { ...validLead, classId: CLASS_ID },
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(mockLeadCreate.mock.callCount(), 0);
    const body = await response.json();
    assert.ok(body.error.includes("class"), body.error);
  });

  it("refuses a contact who works at a different employer", async () => {
    // Otherwise Phase 4 would email Mountain Metal's manager a packet about a
    // Valley Foods job they never posted.
    mockContactFindFirst.mock.mockImplementationOnce(async () => null);
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", {
        method: "POST",
        body: { ...validLead, contactId: CONTACT_ID },
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(mockLeadCreate.mock.callCount(), 0);
  });

  it("copies the employer's name onto the lead", async () => {
    // The denormalised column is what lets a student read their own leads at
    // all; a lead created without it would be invisible to the student path.
    await route.POST(
      mockRequest("/api/teacher/connect/leads", { method: "POST", body: validLead }),
    );
    assert.equal(mockLeadCreate.mock.calls[0].arguments[0].data.employerName, "Mountain Metal");
  });

  it("audits the create", async () => {
    await route.POST(
      mockRequest("/api/teacher/connect/leads", { method: "POST", body: validLead }),
    );
    const entry = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(entry.action, "connect.job_lead.created");
    assert.equal(entry.actorId, session.id);
    assert.equal(entry.targetType, "job_lead");
  });

  it("translates a Prisma foreign-key failure into a plain 404", async () => {
    mockLeadCreate.mock.mockImplementationOnce(async () => {
      throw new Error(
        "Foreign key constraint violated on the constraint: `JobLead_employerId_fkey` in visionquest",
      );
    });
    const response = await route.POST(
      mockRequest("/api/teacher/connect/leads", { method: "POST", body: validLead }),
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(!body.error.includes("fkey"), body.error);
    assert.ok(!body.error.includes("visionquest"), body.error);
  });
});

describe("PUT /api/teacher/connect/leads", () => {
  it("requires an id", async () => {
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/leads", { method: "PUT", body: { status: "filled" } }),
    );
    assert.equal(response.status, 400);
    assert.equal(mockLeadUpdate.mock.callCount(), 0);
  });

  it("refuses retargeting a lead into a class the caller does not instruct", async () => {
    mockClassFindUnique.mock.mockImplementationOnce(async () => null);
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/leads", {
        method: "PUT",
        body: { id: "clh0000000000000000000002", classId: CLASS_ID },
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(mockLeadUpdate.mock.callCount(), 0);
  });

  it("rejects a status outside the vocabulary", async () => {
    const response = await route.PUT(
      mockRequest("/api/teacher/connect/leads", {
        method: "PUT",
        body: { id: "clh0000000000000000000002", status: "archived" },
      }),
    );
    assert.equal(response.status, 400);
  });

  it("audits the update with the new status", async () => {
    await route.PUT(
      mockRequest("/api/teacher/connect/leads", {
        method: "PUT",
        body: { id: "clh0000000000000000000002", status: "filled" },
      }),
    );
    const entry = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(entry.action, "connect.job_lead.updated");
    assert.equal(entry.metadata.status, "filled");
  });
});
