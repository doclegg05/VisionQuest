/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindUnique = mock.fn(async () => null) as any;
const mockUpsert = mock.fn(async () => ({ id: "cd-1" })) as any;
const mockLogAuditEvent = mock.fn(async () => undefined) as any;
const mockAssertStaffCanManageStudent = mock.fn(async () => ({
  id: "stu-1",
  studentId: "SPK-001",
  displayName: "Student One",
  role: "student",
  isActive: true,
})) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      careerDiscovery: { findUnique: mockFindUnique, upsert: mockUpsert },
    },
  },
});
mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: mockAssertStaffCanManageStudent },
});
mock.module("@/lib/api-error", {
  namedExports: {
    // Mirror the real wrapper's error handling closely enough that thrown
    // ApiError-like objects become status responses (the real withTeacherAuth
    // wraps handlers in withErrorHandler).
    withTeacherAuth:
      (handler: (...args: unknown[]) => Promise<Response>) =>
      async (...args: unknown[]) => {
        try {
          return await handler({ id: "teacher-1", role: "teacher" }, ...args);
        } catch (error: unknown) {
          const statusCode =
            error && typeof error === "object" && "statusCode" in error
              ? Number((error as { statusCode: unknown }).statusCode)
              : 500;
          return new Response(JSON.stringify({ error: "error" }), { status: statusCode });
        }
      },
  },
});

let PATCH: typeof import("./route").PATCH;

before(async () => {
  ({ PATCH } = await import("./route"));
});

const params = Promise.resolve({ id: "stu-1" });

function makeRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/teacher/students/[id]/discovery", () => {
  beforeEach(() => {
    mockFindUnique.mock.resetCalls();
    mockUpsert.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();
    mockFindUnique.mock.mockImplementation(async () => null);
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => ({
      id: "stu-1",
      studentId: "SPK-001",
      displayName: "Student One",
      role: "student",
      isActive: true,
    }));
  });

  it("returns 403 when the staff member does not manage the student", async () => {
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => {
      const error = new Error("Forbidden") as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    });

    const res = await PATCH(makeRequest({ status: "complete" }), { params });
    assert.equal(res.status, 403);
    assert.equal(mockUpsert.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });

  it("rejects bodies that do not request the complete status", async () => {
    const res = await PATCH(makeRequest({ status: "in_progress" }), { params });
    assert.equal(res.status, 400);
    assert.equal(mockUpsert.mock.callCount(), 0);
  });

  it("marks discovery complete and writes an override audit event", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      status: "in_progress",
      completedAt: null,
    }));

    const res = await PATCH(makeRequest({ status: "complete" }), { params });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "complete");
    assert.equal(payload.alreadyComplete, false);

    assert.equal(mockUpsert.mock.callCount(), 1);
    const upsertArgs = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(upsertArgs.where.studentId, "stu-1");
    assert.equal(upsertArgs.update.status, "complete");
    assert.ok(upsertArgs.update.completedAt instanceof Date);
    assert.equal(upsertArgs.create.status, "complete");

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const auditArgs = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(auditArgs.action, "teacher.student.discovery_override");
    assert.equal(auditArgs.targetId, "stu-1");
    assert.equal(auditArgs.metadata.source, "manual_override");
    assert.equal(auditArgs.metadata.previousStatus, "in_progress");
  });

  it("creates the discovery record when the extractor never made one", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);

    const res = await PATCH(makeRequest({ status: "complete" }), { params });
    assert.equal(res.status, 200);

    const upsertArgs = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(upsertArgs.create.studentId, "stu-1");
    assert.equal(upsertArgs.create.status, "complete");

    const auditArgs = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(auditArgs.metadata.previousStatus, null);
  });

  it("is idempotent when discovery is already complete", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      status: "complete",
      completedAt: new Date("2026-06-01T12:00:00.000Z"),
    }));

    const res = await PATCH(makeRequest({ status: "complete" }), { params });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.alreadyComplete, true);

    assert.equal(mockUpsert.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });
});
