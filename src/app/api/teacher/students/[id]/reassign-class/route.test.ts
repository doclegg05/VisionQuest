/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
  mockAdminSession,
  mockTeacherSession,
  mockStudentSession,
  mockRequest,
} from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// ---- Mutable "current session" swapped per test. ----
let currentSession: Session = mockAdminSession();

// ---- Mock fns for prisma + helper. ----
const mockStudentFindFirst = mock.fn() as any;
const mockClassFindUnique = mock.fn() as any;
const mockEnrollmentFindFirst = mock.fn() as any;
const mockEnrollmentUpdate = mock.fn() as any;
const mockEnrollmentCreate = mock.fn() as any;
const mockAuditLogCreate = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockGetStudentProgramType = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(currentSession, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number(
              (error as { statusCode: number }).statusCode,
            );
            const message =
              error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    badRequest: (message: string) => makeHttpError(400, message),
    notFound: (message = "Not found") => makeHttpError(404, message),
    conflict: (message: string) => makeHttpError(409, message),
  },
});

mock.module("@/lib/schemas", {
  namedExports: {
    // Simple passthrough parseBody — Zod validation still runs client-side in the route via the imported schema.
    parseBody: async (req: Request, schema: any) => {
      const raw = await req.json();
      const result = schema.safeParse(raw);
      if (!result.success) {
        throw makeHttpError(400, result.error.issues[0]?.message ?? "Invalid body.");
      }
      return result.data;
    },
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    canManageAnyClass: (role: string) =>
      role === "admin" || role === "coordinator",
  },
});

mock.module("@/lib/program-type", {
  namedExports: {
    getStudentProgramType: mockGetStudentProgramType,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findFirst: mockStudentFindFirst },
      spokesClass: { findUnique: mockClassFindUnique },
      studentClassEnrollment: {
        findFirst: mockEnrollmentFindFirst,
        update: mockEnrollmentUpdate,
        create: mockEnrollmentCreate,
      },
      auditLog: { create: mockAuditLogCreate },
      $transaction: mockTransaction,
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  mockStudentFindFirst.mock.resetCalls();
  mockClassFindUnique.mock.resetCalls();
  mockEnrollmentFindFirst.mock.resetCalls();
  mockEnrollmentUpdate.mock.resetCalls();
  mockEnrollmentCreate.mock.resetCalls();
  mockAuditLogCreate.mock.resetCalls();
  mockTransaction.mock.resetCalls();
  mockGetStudentProgramType.mock.resetCalls();

  mockStudentFindFirst.mock.mockImplementation(async () => ({
    id: "stu-1",
    displayName: "Jane Student",
  }));
  mockClassFindUnique.mock.mockImplementation(async () => ({
    id: "class-target",
    status: "active",
    programType: "adult_ed",
    name: "Adult Ed Morning",
  }));
  mockEnrollmentFindFirst.mock.mockImplementation(async () => ({
    id: "enr-current",
    classId: "class-source",
  }));
  mockTransaction.mock.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        studentClassEnrollment: {
          update: mockEnrollmentUpdate,
          create: mockEnrollmentCreate,
        },
      }),
  );
  mockGetStudentProgramType.mock.mockImplementation(async () => "adult_ed");
  currentSession = mockAdminSession();
});

function makePostRequest(body: unknown) {
  return mockRequest("/api/teacher/students/stu-1/reassign-class", {
    method: "POST",
    body,
  });
}

async function callRoute(body: unknown): Promise<Response> {
  return route.POST(makePostRequest(body) as any, {
    params: Promise.resolve({ id: "stu-1" }),
  } as any);
}

describe("POST /api/teacher/students/:id/reassign-class", () => {
  it("rejects a teacher session with 403", async () => {
    currentSession = mockTeacherSession();
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 403);
  });

  it("rejects a student session with 403", async () => {
    currentSession = mockStudentSession();
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 403);
  });

  it("allows a coordinator session", async () => {
    currentSession = { ...mockAdminSession(), role: "coordinator" };
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 200);
  });

  it("returns 400 when newClassId is missing", async () => {
    const res = await callRoute({});
    assert.equal(res.status, 400);
  });

  it("returns 404 when student not found", async () => {
    mockStudentFindFirst.mock.mockImplementation(async () => null);
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 404);
  });

  it("returns 404 when target class not found", async () => {
    mockClassFindUnique.mock.mockImplementation(async () => null);
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 404);
  });

  it("returns 400 when target class is archived", async () => {
    mockClassFindUnique.mock.mockImplementation(async () => ({
      id: "class-target",
      status: "archived",
      programType: "spokes",
      name: "Archived Class",
    }));
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 400);
  });

  it("returns 409 when student is already in the target class", async () => {
    mockEnrollmentFindFirst.mock.mockImplementation(async () => ({
      id: "enr-current",
      classId: "class-target",
    }));
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 409);
  });

  it("archives old enrollment and creates new one on success", async () => {
    const res = await callRoute({ newClassId: "class-target", reason: "moved" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.oldClassId, "class-source");
    assert.equal(json.data.newClassId, "class-target");
    assert.equal(json.data.newProgramType, "adult_ed");

    assert.equal(mockEnrollmentUpdate.mock.callCount(), 1);
    const updateArgs = mockEnrollmentUpdate.mock.calls[0].arguments[0];
    assert.equal(updateArgs.where.id, "enr-current");
    assert.equal(updateArgs.data.status, "archived");
    assert.equal(updateArgs.data.archiveReason, "reassigned_to_class-target");

    assert.equal(mockEnrollmentCreate.mock.callCount(), 1);
    const createArgs = mockEnrollmentCreate.mock.calls[0].arguments[0];
    assert.equal(createArgs.data.studentId, "stu-1");
    assert.equal(createArgs.data.classId, "class-target");
    assert.equal(createArgs.data.status, "active");

    assert.equal(mockAuditLogCreate.mock.callCount(), 1);
    const auditArgs = mockAuditLogCreate.mock.calls[0].arguments[0];
    assert.equal(auditArgs.data.action, "teacher.student.reassign_class");
    assert.equal(auditArgs.data.targetId, "stu-1");
  });

  it("skips archive step when student has no active enrollment", async () => {
    mockEnrollmentFindFirst.mock.mockImplementation(async () => null);
    const res = await callRoute({ newClassId: "class-target" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.oldClassId, null);
    assert.equal(mockEnrollmentUpdate.mock.callCount(), 0);
    assert.equal(mockEnrollmentCreate.mock.callCount(), 1);
  });
});
