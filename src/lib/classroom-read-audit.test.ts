/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
// =============================================================================
// VQ-R-013 — staff reads of student data are audited AT THE GATE.
//
// recordStudentView was wired into 1 of ~13 teacher student-data GETs; every
// other surface passed assertStaffCanManageStudent unaudited. The audit now
// fires inside the gate itself (default surface "student_data", overridable,
// null to opt out for flows audited more precisely elsewhere), so new routes
// are audited by default instead of by convention.
// =============================================================================
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

const mockStudentFindFirst = mock.fn(async () => ({
  id: "stu-1",
  displayName: "Student One",
  studentId: "S-001",
  role: "student",
  isActive: true,
})) as any;
const mockRecordStudentView = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        get findFirst() {
          return mockStudentFindFirst;
        },
      },
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: { recordStudentView: mockRecordStudentView },
});

let assertStaffCanManageStudent: typeof import("./classroom").assertStaffCanManageStudent;

before(async () => {
  ({ assertStaffCanManageStudent } = await import("./classroom"));
});

const teacherSession: Session = {
  id: "teacher-1",
  studentId: "teacher-1",
  displayName: "Teacher One",
  role: "teacher",
};

beforeEach(() => {
  mockStudentFindFirst.mock.resetCalls();
  mockRecordStudentView.mock.resetCalls();
  mockStudentFindFirst.mock.mockImplementation(async () => ({
    id: "stu-1",
    displayName: "Student One",
    studentId: "S-001",
    role: "student",
    isActive: true,
  }));
});

describe("assertStaffCanManageStudent read auditing (VQ-R-013)", () => {
  it("audits every successful staff access with the default surface", async () => {
    const student = await assertStaffCanManageStudent(teacherSession, "stu-1");

    assert.equal(student.id, "stu-1");
    assert.equal(mockRecordStudentView.mock.callCount(), 1);
    const audit = mockRecordStudentView.mock.calls[0].arguments[0];
    assert.equal(audit.actorId, "teacher-1");
    assert.equal(audit.actorRole, "teacher");
    assert.equal(audit.targetStudentId, "stu-1");
    assert.equal(audit.surface, "student_data");
  });

  it("honors a caller-provided surface", async () => {
    await assertStaffCanManageStudent(teacherSession, "stu-1", { auditSurface: "student_detail" });
    assert.equal(mockRecordStudentView.mock.calls[0].arguments[0].surface, "student_detail");
  });

  it("skips the gate audit when the caller opts out with null", async () => {
    await assertStaffCanManageStudent(teacherSession, "stu-1", { auditSurface: null });
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
  });

  it("never audits a denied access", async () => {
    mockStudentFindFirst.mock.mockImplementation(async () => null);
    await assert.rejects(() => assertStaffCanManageStudent(teacherSession, "nope"));
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
  });
});
