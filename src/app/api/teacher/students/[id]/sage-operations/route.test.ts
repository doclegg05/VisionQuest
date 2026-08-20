/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// ---- Mutable "current session" swapped per test, mirroring the
// reassign-class/route.test.ts convention for real-role-gate coverage. ----
let currentSession: Session = mockTeacherSession();

const mockAssertStaffCanManageStudent = mock.fn() as any;
const mockRecordStudentView = mock.fn() as any;
const mockFetchOperationsForStudent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function isStaffRole(role: string) {
  return role === "teacher" || role === "admin";
}

mock.module("@/lib/api-error", {
  namedExports: {
    // Faithful to the real withTeacherAuth contract (role gate + error
    // catch) so "teacher-only 403 for students" is a real assertion here,
    // not just delegated to shared middleware this test bypasses.
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          if (!isStaffRole(currentSession.role)) {
            throw makeHttpError(403, "Forbidden");
          }
          return await handler(currentSession, ...args);
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
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    notFound: (message = "Not found") => makeHttpError(404, message),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: mockAssertStaffCanManageStudent,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    recordStudentView: mockRecordStudentView,
  },
});

mock.module("@/lib/sage/operations", {
  namedExports: {
    fetchOperationsForStudent: mockFetchOperationsForStudent,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/teacher/students/[id]/sage-operations", () => {
  beforeEach(() => {
    currentSession = mockTeacherSession();
    mockAssertStaffCanManageStudent.mock.resetCalls();
    mockRecordStudentView.mock.resetCalls();
    mockFetchOperationsForStudent.mock.resetCalls();

    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => ({ id: "stu-1" }));
    mockRecordStudentView.mock.mockImplementation(async () => undefined);
    mockFetchOperationsForStudent.mock.mockImplementation(async () => ({
      operations: [
        {
          id: "op-1",
          toolName: "update_goal_status",
          targetSummary: "Updated a goal's status",
          status: "executed",
          statusLabel: "Completed",
          actorRole: "student",
          actorRoleLabel: "Student",
          createdAt: "2026-08-20T12:00:00.000Z",
          updatedAt: "2026-08-20T12:00:00.000Z",
        },
      ],
      hasMore: false,
    }));
  });

  const params = Promise.resolve({ id: "stu-1" });

  it("returns the safe ledger rows for a managed student", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations");
    const res = await route.GET(req as never, { params } as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.operations.length, 1);
    assert.equal(body.data.operations[0].id, "op-1");
    assert.equal(body.data.hasMore, false);
    // Never leaks payload/resultSummary even if a future regression added
    // them to fetchOperationsForStudent's return shape.
    assert.equal("payload" in body.data.operations[0], false);
    assert.equal("resultSummary" in body.data.operations[0], false);
  });

  it("authorizes via assertStaffCanManageStudent (cross-class denial red-baseline)", async () => {
    mockAssertStaffCanManageStudent.mock.mockImplementationOnce(async () => {
      throw makeHttpError(403, "You do not have access to this student.");
    });

    const req = mockRequest("/api/teacher/students/stu-1/sage-operations");
    const res = await route.GET(req as never, { params } as never);
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.match(String(body.error), /do not have access/i);
    assert.equal(mockFetchOperationsForStudent.mock.callCount(), 0);
    assert.equal(mockRecordStudentView.mock.callCount(), 0);
  });

  it("returns 403 for a student session (teacher-only route)", async () => {
    currentSession = mockStudentSession();

    const req = mockRequest("/api/teacher/students/stu-1/sage-operations");
    const res = await route.GET(req as never, { params } as never);

    assert.equal(res.status, 403);
    assert.equal(mockAssertStaffCanManageStudent.mock.callCount(), 0);
    assert.equal(mockFetchOperationsForStudent.mock.callCount(), 0);
  });

  it("records a staff read-access audit event for the surface", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations");
    await route.GET(req as never, { params } as never);

    assert.equal(mockRecordStudentView.mock.callCount(), 1);
    const auditArgs = mockRecordStudentView.mock.calls[0].arguments[0];
    assert.equal(auditArgs.actorId, currentSession.id);
    assert.equal(auditArgs.actorRole, currentSession.role);
    assert.equal(auditArgs.targetStudentId, "stu-1");
    assert.equal(auditArgs.surface, "sage_operations");
  });

  it("passes page and limit through to fetchOperationsForStudent", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations", {
      searchParams: { page: "2", limit: "10" },
    });
    await route.GET(req as never, { params } as never);

    assert.deepEqual(mockFetchOperationsForStudent.mock.calls[0].arguments, [
      "stu-1",
      { page: 2, limit: 10 },
    ]);
  });

  it("rejects an invalid limit with 400 before touching the database", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations", {
      searchParams: { limit: "not-a-number" },
    });
    const res = await route.GET(req as never, { params } as never);

    assert.equal(res.status, 400);
    assert.equal(mockFetchOperationsForStudent.mock.callCount(), 0);
  });

  it("rejects a limit above the max with 400", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations", {
      searchParams: { limit: "500" },
    });
    const res = await route.GET(req as never, { params } as never);

    assert.equal(res.status, 400);
    assert.equal(mockFetchOperationsForStudent.mock.callCount(), 0);
  });

  it("rejects a page above the 10,000 bound with 400 (S2 — matches the memories route's page cap)", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations", {
      searchParams: { page: "10001" },
    });
    const res = await route.GET(req as never, { params } as never);

    assert.equal(res.status, 400);
    assert.equal(mockFetchOperationsForStudent.mock.callCount(), 0);
  });

  it("accepts a page at the 10,000 bound", async () => {
    const req = mockRequest("/api/teacher/students/stu-1/sage-operations", {
      searchParams: { page: "10000" },
    });
    const res = await route.GET(req as never, { params } as never);

    assert.equal(res.status, 200);
    assert.deepEqual(mockFetchOperationsForStudent.mock.calls[0].arguments, [
      "stu-1",
      { page: 10000, limit: 20 },
    ]);
  });
});
