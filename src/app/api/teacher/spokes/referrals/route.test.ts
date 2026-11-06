/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Unlinked SPOKES referrals (studentId: null) are applicants with no class.
// Under the organization tree only admins and program coordinators see them;
// an instructor sees none, whatever class they teach.
const APPLICANT = {
  id: "ref-1",
  firstName: "Ava",
  lastName: "Applicant",
  referralEmail: "ava@example.com",
  county: "Kanawha",
  householdType: "single",
};

const session = { current: { id: "teacher-1", role: "teacher" } as { id: string; role: string } };

const mockTemplateFindMany = mock.fn(async () => [{ id: "county-1", label: "Kanawha" }]) as any;
const mockRecordFindMany = mock.fn(async () => [APPLICANT]) as any;
const mockRecordFindUnique = mock.fn(async () => ({ ...APPLICANT, studentId: null })) as any;
const mockRecordCreate = mock.fn(async (args: any) => ({ id: "ref-new", ...args.data })) as any;
const mockRecordDelete = mock.fn(async () => APPLICANT) as any;
const mockLogAuditEvent = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      spokesChecklistTemplate: { findMany: mockTemplateFindMany },
      spokesRecord: {
        findMany: mockRecordFindMany,
        findUnique: mockRecordFindUnique,
        delete: mockRecordDelete,
        create: mockRecordCreate,
      },
    },
  },
});
mock.module("@/lib/audit", { namedExports: { logAuditEvent: mockLogAuditEvent } });
mock.module("@/lib/api-error", {
  namedExports: {
    badRequest: (message: string) => Object.assign(new Error(message), { statusCode: 400 }),
    forbidden: (message = "Forbidden") => Object.assign(new Error(message), { statusCode: 403 }),
    // Mirrors the real wrapper: only the roles `isStaffRole` admits reach the handler.
    withTeacherAuth: (handler: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      if (session.current.role !== "teacher" && session.current.role !== "admin") {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }
      return handler(session.current, ...args);
    },
  },
});

let GET: typeof import("./route").GET;
let DELETE: typeof import("./route").DELETE;
let POST: typeof import("./route").POST;

before(async () => {
  ({ GET, DELETE, POST } = await import("./route"));
});

function deleteRequest(id: string): Request {
  return new Request("http://localhost/api/teacher/spokes/referrals", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

beforeEach(() => {
  session.current = { id: "teacher-1", role: "teacher" };
  for (const fn of [
    mockTemplateFindMany,
    mockRecordFindMany,
    mockRecordFindUnique,
    mockRecordDelete,
    mockRecordCreate,
    mockLogAuditEvent,
  ]) {
    fn.mock.resetCalls();
  }
});

describe("GET /api/teacher/spokes/referrals", () => {
  it("gives an instructor an empty applicant list and never reads the unlinked records", async () => {
    const res = (await GET(new Request("http://localhost/api/teacher/spokes/referrals"))) as Response;
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.referrals, []);
    assert.equal(mockRecordFindMany.mock.callCount(), 0);
    // County options are a program catalog, not student data: still returned.
    assert.equal(body.countyOptions.length, 1);
  });

  it("lists unlinked applicants to an admin", async () => {
    session.current = { id: "admin-1", role: "admin" };

    const res = (await GET(new Request("http://localhost/api/teacher/spokes/referrals"))) as Response;
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.referrals, [APPLICANT]);
    assert.equal(mockRecordFindMany.mock.calls[0].arguments[0].where.studentId, null);
  });
});

describe("DELETE /api/teacher/spokes/referrals", () => {
  it("refuses an instructor with 403 and deletes nothing", async () => {
    const res = (await DELETE(deleteRequest("ref-1"))) as Response;

    assert.equal(res.status, 403);
    assert.equal(mockRecordFindUnique.mock.callCount(), 0);
    assert.equal(mockRecordDelete.mock.callCount(), 0);
  });

  it("lets an admin delete an unlinked applicant", async () => {
    session.current = { id: "admin-1", role: "admin" };

    const res = (await DELETE(deleteRequest("ref-1"))) as Response;

    assert.equal(res.status, 200);
    assert.equal(mockRecordDelete.mock.callCount(), 1);
    assert.deepEqual(mockRecordDelete.mock.calls[0].arguments[0], { where: { id: "ref-1" } });
  });
});

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/teacher/spokes/referrals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    return ((await run()) as Response).status;
  } catch (error) {
    return (error as { statusCode: number }).statusCode;
  }
}

describe("POST /api/teacher/spokes/referrals", () => {
  const valid = { firstName: "Ava", lastName: "Applicant", county: "Kanawha" };

  it("refuses an instructor: an unlinked referral would be one they cannot see", async () => {
    const status = await statusOf(() => POST(postRequest(valid)) as Promise<unknown>);

    assert.equal(status, 403);
    assert.equal(mockRecordCreate.mock.callCount(), 0);
  });

  it("lets an admin create one with no class", async () => {
    session.current = { id: "admin-1", role: "admin" };

    const res = (await POST(postRequest(valid))) as Response;

    assert.equal(res.status, 201);
    assert.equal(mockRecordCreate.mock.callCount(), 1);
    assert.equal(mockRecordCreate.mock.calls[0].arguments[0].data.firstName, "Ava");
  });

  it("refuses a program coordinator before the handler runs, as the real wrapper does", async () => {
    session.current = { id: "pc-1", role: "program_coordinator" };

    const status = await statusOf(() => POST(postRequest(valid)) as Promise<unknown>);

    assert.equal(status, 403);
    assert.equal(mockRecordCreate.mock.callCount(), 0);
  });

  it("rejects a body without a last name through the schema", async () => {
    session.current = { id: "admin-1", role: "admin" };

    const status = await statusOf(() => POST(postRequest({ firstName: "Ava" })) as Promise<unknown>);

    assert.equal(status, 400);
    assert.equal(mockRecordCreate.mock.callCount(), 0);
  });
});
