/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Organization tree (Ruling R22): program coordinators download cohort packets
// like regional coordinators do. Only @/lib/db is mocked among the scoping
// modules, so the real @/lib/classroom and @/lib/org-roles decide the scope.

let currentSession: Session | null = null;

const mockStudentFindMany = mock.fn() as any;
const mockClassFindFirst = mock.fn() as any;
const mockListStudents = mock.fn() as any;
const mockDownload = mock.fn() as any;
const mockAudit = mock.fn() as any;

mock.module("@/lib/auth", { namedExports: { getSession: async () => currentSession } });
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findMany: mockStudentFindMany },
      spokesClass: { findFirst: mockClassFindFirst },
    },
  },
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

const programCoordinator = (): Session => ({
  id: "pc-1",
  studentId: "pc",
  displayName: "Program Coordinator",
  role: "program_coordinator",
});
const regionalCoordinator = (): Session => ({
  id: "rc-1",
  studentId: "rc",
  displayName: "Regional Coordinator",
  role: "coordinator",
});

beforeEach(() => {
  for (const m of [mockStudentFindMany, mockClassFindFirst, mockListStudents, mockDownload, mockAudit]) {
    m.mock.resetCalls();
  }
  mockStudentFindMany.mock.mockImplementation(async () => [{ id: "s1" }]);
  mockClassFindFirst.mock.mockImplementation(async () => ({ id: "c" }));
  mockListStudents.mock.mockImplementation(async () => [
    { id: "s1", displayName: "A B", studentId: "login-s1", firstName: "A", lastName: "B", storageKey: "k1" },
  ]);
  mockDownload.mock.mockImplementation(async () => ({ buffer: Buffer.from("pdf") }));
  mockAudit.mock.mockImplementation(async () => ({ audited: true }));
});

async function call(): Promise<Response> {
  return route.GET(mockRequest("/api/teacher/classes/export-packets", { method: "GET" }) as any);
}

describe("GET /api/teacher/classes/export-packets by organization role", () => {
  it("lets a program coordinator download, across every region (no class or region filter)", async () => {
    currentSession = programCoordinator();
    const res = await call();
    assert.equal(res.status, 200);
    const where = mockStudentFindMany.mock.calls[0].arguments[0].where;
    assert.equal(where.classEnrollments, undefined);
    assert.equal(where.role, "student");
    assert.equal(mockAudit.mock.calls[0].arguments[0].actorRole, "program_coordinator");
  });

  it("keeps a regional coordinator limited to the regions they are assigned to", async () => {
    currentSession = regionalCoordinator();
    const res = await call();
    assert.equal(res.status, 200);
    const where = mockStudentFindMany.mock.calls[0].arguments[0].where;
    assert.deepEqual(where.classEnrollments.some.class, {
      region: { coordinators: { some: { coordinatorId: "rc-1" } } },
    });
  });

  it("still refuses a student session", async () => {
    currentSession = { ...mockTeacherSession(), role: "student" };
    const res = await call();
    assert.equal(res.status, 401);
  });
});
