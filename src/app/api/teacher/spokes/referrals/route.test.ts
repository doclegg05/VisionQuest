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
      },
    },
  },
});
mock.module("@/lib/audit", { namedExports: { logAuditEvent: mockLogAuditEvent } });
mock.module("@/lib/api-error", {
  namedExports: {
    badRequest: (message: string) => Object.assign(new Error(message), { statusCode: 400 }),
    withTeacherAuth: (handler: (...args: unknown[]) => unknown) => (...args: unknown[]) =>
      handler(session.current, ...args),
  },
});

let GET: typeof import("./route").GET;
let DELETE: typeof import("./route").DELETE;

before(async () => {
  ({ GET, DELETE } = await import("./route"));
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

  it("lists unlinked applicants to a program coordinator", async () => {
    session.current = { id: "pc-1", role: "program_coordinator" };

    const res = (await GET(new Request("http://localhost/api/teacher/spokes/referrals"))) as Response;
    const body = await res.json();

    assert.deepEqual(body.referrals, [APPLICANT]);
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
