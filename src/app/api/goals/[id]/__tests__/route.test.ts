import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession, mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Request-level tests for PATCH /api/goals/[id] — the Sage-proposed goal
// confirmation guard (QW-5).
//
// Product rule (docs/PRODUCT_DECISIONS.md): AI may not finalize a student
// goal — a goal Sage proposed (sourceMessageId != null) must be confirmed by
// staff via /api/teacher/students/[id]/goals/[goalId], never by the student.
// Students may still confirm goals they created themselves.
//
// The student route is wrapped in `withRegistry("goals.update", ...)`; we
// mock the registry middleware as a passthrough that hands the test session
// to the inner handler (same pattern as chat/send/__tests__/route.test.ts).
// The teacher route uses `withTeacherAuth`, mocked the same way.
// ---------------------------------------------------------------------------

const studentSession = mockStudentSession();
const teacherSession = mockTeacherSession();

const mockGoalFindFirst = mock.fn<(args: unknown) => Promise<unknown>>();
const mockGoalUpdate = mock.fn<(args: { where: unknown; data: Record<string, unknown> }) => Promise<unknown>>();
const mockPathwayFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockInvalidatePrefix = mock.fn<(prefix: string) => void>();
const mockEnsureGoalLevelProgression = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockUpdateProgression = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockAssertStaffCanManageStudent = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

function apiError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.name = "ApiError";
  err.statusCode = statusCode;
  return err;
}

function toResponse(err: unknown): Response {
  if (err && typeof err === "object" && "statusCode" in err) {
    const statusCode = Number((err as { statusCode: number }).statusCode);
    const message = err instanceof Error ? err.message : "Request failed";
    return Response.json({ error: message }, { status: statusCode });
  }
  throw err;
}

mock.module("@/lib/api-error", {
  namedExports: {
    badRequest: (msg: string) => apiError(400, msg),
    notFound: (msg = "Not found") => apiError(404, msg),
    forbidden: (msg = "Forbidden") => apiError(403, msg),
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: typeof teacherSession, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(teacherSession, ...args);
        } catch (err) {
          return toResponse(err);
        }
      },
  },
});

mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (
        _toolId: string,
        handler: (
          sessionArg: typeof studentSession,
          req: Request,
          ctx: { params: Promise<Record<string, string>> },
          tool: unknown,
        ) => Promise<Response>,
      ) =>
      async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
        try {
          return await handler(studentSession, req, ctx, { id: "goals.update" });
        } catch (err) {
          return toResponse(err);
        }
      },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      goal: { findFirst: mockGoalFindFirst, update: mockGoalUpdate },
      pathway: { findUnique: mockPathwayFindUnique },
    },
  },
});

mock.module("@/lib/cache", {
  namedExports: { invalidatePrefix: mockInvalidatePrefix },
});

mock.module("@/lib/goal-progression", {
  namedExports: { ensureGoalLevelProgression: mockEnsureGoalLevelProgression },
});

mock.module("@/lib/progression/engine", {
  namedExports: { recordBhagCompleted: () => ({}) },
});

mock.module("@/lib/progression/service", {
  namedExports: { updateProgression: mockUpdateProgression },
});

mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: mockAssertStaffCanManageStudent },
});

let studentRoute: typeof import("../route");
let teacherRoute: typeof import("../../../teacher/students/[id]/goals/[goalId]/route");

before(async () => {
  studentRoute = await import("../route");
  teacherRoute = await import("../../../teacher/students/[id]/goals/[goalId]/route");
});

// --- Fixtures ---

const sageProposedGoal = {
  id: "goal-sage-1",
  level: "monthly",
  content: "Earn the OSHA-10 card",
  status: "proposed",
  parentId: null,
  sourceMessageId: "msg-123",
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

const studentCreatedGoal = {
  id: "goal-own-1",
  level: "monthly",
  content: "Finish my resume draft",
  status: "active",
  parentId: null,
  sourceMessageId: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

function patchRequest(goal: { id: string }, body: Record<string, unknown>): Request {
  return mockRequest(`/api/goals/${goal.id}`, { method: "PATCH", body });
}

function studentCtx(goalId: string) {
  return { params: Promise.resolve({ id: goalId }) };
}

describe("PATCH /api/goals/[id] — Sage-proposed confirmation guard", () => {
  beforeEach(() => {
    mockGoalFindFirst.mock.resetCalls();
    mockGoalUpdate.mock.resetCalls();
    mockInvalidatePrefix.mock.resetCalls();
    mockEnsureGoalLevelProgression.mock.resetCalls();
    mockUpdateProgression.mock.resetCalls();

    mockGoalUpdate.mock.mockImplementation(async ({ data }) => ({
      ...sageProposedGoal,
      ...data,
    }));
  });

  it("rejects a student confirming a Sage-proposed goal with 403", async () => {
    mockGoalFindFirst.mock.mockImplementation(async () => sageProposedGoal);

    const res = await studentRoute.PATCH(
      patchRequest(sageProposedGoal, { confirm: true }),
      studentCtx(sageProposedGoal.id),
    );

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Sage suggested this goal — ask your instructor to confirm it.");
    assert.equal(mockGoalUpdate.mock.callCount(), 0, "goal must not be updated");
  });

  it("rejects the status: 'confirmed' spelling of confirmation the same way", async () => {
    mockGoalFindFirst.mock.mockImplementation(async () => sageProposedGoal);

    const res = await studentRoute.PATCH(
      patchRequest(sageProposedGoal, { status: "confirmed" }),
      studentCtx(sageProposedGoal.id),
    );

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Sage suggested this goal — ask your instructor to confirm it.");
    assert.equal(mockGoalUpdate.mock.callCount(), 0, "goal must not be updated");
  });

  it("allows a student to confirm a goal they created themselves", async () => {
    mockGoalFindFirst.mock.mockImplementation(async () => studentCreatedGoal);
    mockGoalUpdate.mock.mockImplementation(async ({ data }) => ({
      ...studentCreatedGoal,
      ...data,
    }));

    const res = await studentRoute.PATCH(
      patchRequest(studentCreatedGoal, { confirm: true }),
      studentCtx(studentCreatedGoal.id),
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.goal.status, "confirmed");
    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    const updateData = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(updateData.status, "confirmed");
    assert.equal(updateData.confirmedBy, studentSession.id);
    assert.ok(updateData.confirmedAt instanceof Date);
  });

  it("still allows non-confirmation edits to a Sage-proposed goal", async () => {
    mockGoalFindFirst.mock.mockImplementation(async () => sageProposedGoal);

    const res = await studentRoute.PATCH(
      patchRequest(sageProposedGoal, { content: "Earn the OSHA-10 card by August" }),
      studentCtx(sageProposedGoal.id),
    );

    assert.equal(res.status, 200);
    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    const updateData = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(updateData.content, "Earn the OSHA-10 card by August");
    assert.equal(updateData.status, undefined, "no status change");
    assert.equal(updateData.confirmedBy, undefined, "no confirmation recorded");
  });

  it("still allows a student to dismiss (abandon) a Sage-proposed goal", async () => {
    mockGoalFindFirst.mock.mockImplementation(async () => sageProposedGoal);

    const res = await studentRoute.PATCH(
      patchRequest(sageProposedGoal, { status: "abandoned" }),
      studentCtx(sageProposedGoal.id),
    );

    assert.equal(res.status, 200);
    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    const updateData = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(updateData.status, "abandoned");
    assert.equal(updateData.confirmedBy, undefined, "no confirmation recorded");
  });
});

describe("PATCH /api/teacher/students/[id]/goals/[goalId] — sanctioned staff path", () => {
  beforeEach(() => {
    mockGoalFindFirst.mock.resetCalls();
    mockGoalUpdate.mock.resetCalls();
    mockInvalidatePrefix.mock.resetCalls();
    mockEnsureGoalLevelProgression.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();

    mockGoalFindFirst.mock.mockImplementation(async () => sageProposedGoal);
    mockGoalUpdate.mock.mockImplementation(async ({ data }) => ({
      ...sageProposedGoal,
      ...data,
    }));
  });

  it("lets a teacher confirm a Sage-proposed goal", async () => {
    const res = await teacherRoute.PATCH(
      mockRequest(`/api/teacher/students/stu-test-001/goals/${sageProposedGoal.id}`, {
        method: "PATCH",
        body: { confirm: true },
      }),
      { params: Promise.resolve({ id: "stu-test-001", goalId: sageProposedGoal.id }) },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.goal.status, "confirmed");
    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    const updateData = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(updateData.status, "confirmed");
    assert.equal(updateData.confirmedBy, teacherSession.id, "teacher recorded as confirmer");
  });
});
