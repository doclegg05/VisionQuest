/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
  mockAdminSession,
  mockRequest,
  mockStudentSession,
  mockTeacherSession,
} from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

let currentSession: Session | null = mockTeacherSession();

const CLASS_ID = "ckabcdefghijklmnopqrstuvw";

const mockAssertCanManage = mock.fn() as any;
const mockListIds = mock.fn() as any;
const mockListStudents = mock.fn() as any;
const mockDownload = mock.fn() as any;
const mockAudit = mock.fn() as any;

mock.module("@/lib/auth", { namedExports: { getSession: async () => currentSession } });
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageClass: mockAssertCanManage, listManagedStudentIds: mockListIds },
});
mock.module("@/lib/teacher/cohort-packets", {
  namedExports: { listCohortPacketStudents: mockListStudents },
});
mock.module("@/lib/storage", { namedExports: { downloadFile: mockDownload } });
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: mockAudit } });

let route: Awaited<typeof import("./route")>;
before(async () => {
  route = await import("./route");
});

function student(id: string, storageKey: string | null) {
  return {
    id,
    displayName: `Name ${id}`,
    studentId: `login-${id}`,
    firstName: "Jane",
    lastName: "Doe",
    storageKey,
  };
}

beforeEach(() => {
  for (const m of [mockAssertCanManage, mockListIds, mockListStudents, mockDownload, mockAudit]) {
    m.mock.resetCalls();
  }
  currentSession = mockTeacherSession();
  mockAssertCanManage.mock.mockImplementation(async () => undefined);
  mockListIds.mock.mockImplementation(async () => ["s1", "s2", "s3"]);
  mockListStudents.mock.mockImplementation(async () => [
    student("s1", "k1"),
    student("s2", "k2"),
    student("s3", null),
  ]);
  mockDownload.mock.mockImplementation(async (key: string) =>
    key === "k1" ? { buffer: Buffer.from("pdf1") } : null,
  );
  mockAudit.mock.mockImplementation(async () => ({ audited: true }));
});

async function call(query: string): Promise<Response> {
  const req = mockRequest(`/api/teacher/classes/export-packets${query}`, { method: "GET" });
  return route.GET(req as any);
}

describe("GET /api/teacher/classes/export-packets", () => {
  it("writes exactly one audit row with packet counts and no student identity", async () => {
    const res = await call(`?classId=${CLASS_ID}`);
    assert.equal(res.status, 200);
    assert.equal(mockAudit.mock.callCount(), 1);
    const input = mockAudit.mock.calls[0].arguments[0];
    assert.equal(input.action, "teacher.class.packets_exported");
    assert.equal(input.targetType, "class");
    assert.equal(input.targetId, CLASS_ID);
    assert.equal(input.actorId, (currentSession as Session).id);
    assert.equal(input.actorRole, "teacher");
    assert.deepEqual(input.metadata, { included: 1, missing: 2 });
    assert.match(input.summary, /1 intake packet/);
    const serialized = JSON.stringify(input);
    assert.doesNotMatch(serialized, /s1|s2|s3|Name |login-|Doe/);
  });

  it("still delivers the download when the audit write fails", async () => {
    mockAudit.mock.mockImplementation(async () => ({ audited: false }));
    const res = await call(`?classId=${CLASS_ID}`);
    assert.equal(res.status, 200);
  });

  it("returns 400 for a malformed classId and reads nothing", async () => {
    const res = await call("?classId=not-a-cuid");
    assert.equal(res.status, 400);
    assert.equal(mockAssertCanManage.mock.callCount(), 0);
    assert.equal(mockListStudents.mock.callCount(), 0);
    assert.equal(mockAudit.mock.callCount(), 0);
  });

  it("refuses a student session and an anonymous caller without reading or auditing", async () => {
    for (const s of [mockStudentSession(), null]) {
      currentSession = s;
      const res = await call(`?classId=${CLASS_ID}`);
      assert.equal(res.status, 401);
    }
    assert.equal(mockListIds.mock.callCount(), 0);
    assert.equal(mockAudit.mock.callCount(), 0);
  });

  it("checks class ownership before any read and audits nothing on denial", async () => {
    mockAssertCanManage.mock.mockImplementation(async () => {
      throw new Error("nope");
    });
    const res = await call(`?classId=${CLASS_ID}`);
    assert.equal(res.status, 403);
    assert.equal(mockListIds.mock.callCount(), 0);
    assert.equal(mockListStudents.mock.callCount(), 0);
    assert.equal(mockAudit.mock.callCount(), 0);
  });

  it("allows an admin session", async () => {
    currentSession = mockAdminSession();
    const res = await call(`?classId=${CLASS_ID}`);
    assert.equal(res.status, 200);
  });
});
