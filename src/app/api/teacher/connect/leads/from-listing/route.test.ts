/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/**
 * POST /api/teacher/connect/leads/from-listing — "Make this a lead"
 * (Match & Connect Task 3.2).
 *
 * The rule worth pinning is idempotence: an instructor who clicks twice, or
 * two instructors who click at the same moment, must end up with ONE lead and
 * ONE employer. The second click returns the first lead with created:false and
 * writes no audit row, because nothing happened.
 */

const session = mockTeacherSession();
let currentRole = "teacher";

const listing = {
  id: "clh0000000000000000000009",
  title: "Production Associate",
  company: "  Mountain   Metal ",
  location: "Beckley, WV",
  description: "Runs the press line.",
  url: "https://example.test/posting/1",
  clusters: ["career-readiness"],
  salaryMin: 15,
};

let existingLead: unknown = null;

const mockListingFindUnique = mock.fn(async () => listing) as any;
const mockLeadFindFirst = mock.fn(async () => existingLead) as any;
const mockLeadCreate = mock.fn(async (args: any) => ({
  id: "lead-new",
  ...args.data,
  employer: { id: args.data.employerId, name: "Mountain Metal" },
})) as any;
const mockEmployerUpsert = mock.fn(async (args: any) => ({
  id: "emp-1",
  name: args.create.name,
  nameKey: args.where.nameKey,
})) as any;
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
      jobListing: {
        get findUnique() {
          return mockListingFindUnique;
        },
      },
      jobLead: {
        get findFirst() {
          return mockLeadFindFirst;
        },
        get create() {
          return mockLeadCreate;
        },
      },
      employer: {
        get upsert() {
          return mockEmployerUpsert;
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
  existingLead = null;
  mockListingFindUnique.mock.resetCalls();
  mockLeadFindFirst.mock.resetCalls();
  mockLeadCreate.mock.resetCalls();
  mockEmployerUpsert.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
});

function post(body: unknown) {
  return route.POST(
    mockRequest("/api/teacher/connect/leads/from-listing", { method: "POST", body }),
  );
}

describe("POST /api/teacher/connect/leads/from-listing", () => {
  it("refuses a student session before touching the database", async () => {
    currentRole = "student";
    const response = await post({ jobListingId: listing.id });
    assert.equal(response.status, 403);
    assert.equal(mockListingFindUnique.mock.callCount(), 0);
  });

  it("rejects a body with no listing id", async () => {
    const response = await post({});
    assert.equal(response.status, 400);
    assert.equal(mockLeadCreate.mock.callCount(), 0);
  });

  it("rejects an id that is not a cuid", async () => {
    const response = await post({ jobListingId: "../../etc/passwd" });
    assert.equal(response.status, 400);
  });

  it("copies title, location, description and url onto the lead", async () => {
    const response = await post({ jobListingId: listing.id });
    assert.equal(response.status, 200);
    const data = mockLeadCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.title, "Production Associate");
    assert.equal(data.location, "Beckley, WV");
    assert.ok(data.description.includes("Runs the press line."));
    assert.ok(
      data.description.includes(listing.url),
      "JobLead has no url column; the posting link must survive in the description",
    );
  });

  it("records the provenance the server chose, never a client's", async () => {
    await post({ jobListingId: listing.id });
    const data = mockLeadCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.source, "joblisting");
    assert.equal(data.sourceRef, listing.id);
  });

  it("finds or creates the employer by its normalized name", async () => {
    await post({ jobListingId: listing.id });
    const args = mockEmployerUpsert.mock.calls[0].arguments[0];
    assert.equal(args.where.nameKey, "mountain metal");
    assert.equal(args.create.name, "Mountain Metal", "whitespace collapsed for display too");
    assert.deepEqual(args.update, {}, "an existing employer's curated details are not overwritten");
  });

  it("returns the existing lead on a second click and creates nothing", async () => {
    existingLead = { id: "lead-1", title: "Production Associate", employer: { name: "Mountain Metal" } };
    const response = await post({ jobListingId: listing.id });
    const body = await response.json();
    assert.equal(body.created, false);
    assert.equal(body.lead.id, "lead-1");
    assert.equal(mockLeadCreate.mock.callCount(), 0);
    assert.equal(mockEmployerUpsert.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0, "nothing happened, so nothing is audited");
  });

  it("audits the first conversion", async () => {
    await post({ jobListingId: listing.id });
    const entry = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(entry.action, "connect.job_lead.created");
    assert.equal(entry.metadata.source, "joblisting");
    assert.equal(entry.metadata.sourceRef, listing.id);
  });

  it("returns a plain 404 for a posting that does not exist", async () => {
    mockListingFindUnique.mock.mockImplementationOnce(async () => null);
    const response = await post({ jobListingId: listing.id });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(!body.error.includes("prisma"), body.error);
  });
});
