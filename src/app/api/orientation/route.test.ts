import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession, mockRequest } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// P0-1 guard coverage: students must not be able to mark a signature-required
// orientation item complete unless every required signed form is on file.
// Uses the REAL step classification (orientation-step-resources + spokes
// forms catalog) so the guard is exercised against production form metadata.

let currentSession: Session = mockStudentSession();

const mockItemFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockProgressUpsert = mock.fn<(args: {
  where: { studentId_itemId: { studentId: string; itemId: string } };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}) => Promise<unknown>>();
const mockSubmissionFindMany = mock.fn<(args: unknown) => Promise<unknown[]>>();
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();
const mockAssertStaffCanManageStudent = mock.fn<(session: Session, studentId: string) => Promise<void>>();

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
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      orientationItem: {
        findUnique: mockItemFindUnique,
      },
      orientationProgress: {
        upsert: mockProgressUpsert,
      },
      formSubmission: {
        findMany: mockSubmissionFindMany,
      },
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mockSyncStudentAlerts,
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: mockAssertStaffCanManageStudent,
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

const ITEM_ID = "seed-orient-1";
const OTHER_STUDENT_ID = "cjld2cjxh0000qzrmn831i7rn";

function toggleRequest(body: unknown): Request {
  return mockRequest("/api/orientation", { method: "POST", body }) as never;
}

describe("POST /api/orientation (signature guard)", () => {
  beforeEach(() => {
    currentSession = mockStudentSession();
    mockItemFindUnique.mock.resetCalls();
    mockProgressUpsert.mock.resetCalls();
    mockSubmissionFindMany.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();

    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Review Rights and Responsibilities",
    }));
    mockSubmissionFindMany.mock.mockImplementation(async () => []);
    mockProgressUpsert.mock.mockImplementation(async () => ({}));
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => undefined);
  });

  it("rejects a student completing a signature-required item with no signed form", async () => {
    const res = await route.POST(toggleRequest({ itemId: ITEM_ID, completed: true }));
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(body.error, /needs your signature/i);
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("allows the student once the required signature is on file", async () => {
    mockSubmissionFindMany.mock.mockImplementation(async () => [
      { formId: "rights-responsibilities" },
    ]);

    const res = await route.POST(toggleRequest({ itemId: ITEM_ID, completed: true }));

    assert.equal(res.status, 200);
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
    const call = mockProgressUpsert.mock.calls[0].arguments[0];
    assert.equal(call.where.studentId_itemId.studentId, currentSession.id);
    assert.equal(call.where.studentId_itemId.itemId, ITEM_ID);
    assert.equal(call.update.completed, true);
  });

  it("requires every sign-step form of a multi-form item (release packet)", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Sign Authorization for Release of Information",
    }));
    // Only one of the two sign-step forms is signed; ai-data-consent has no
    // PDF and must NOT be demanded.
    mockSubmissionFindMany.mock.mockImplementation(async () => [
      { formId: "auth-release" },
    ]);

    const rejected = await route.POST(toggleRequest({ itemId: ITEM_ID, completed: true }));
    assert.equal(rejected.status, 400);
    assert.equal(mockProgressUpsert.mock.callCount(), 0);

    mockSubmissionFindMany.mock.mockImplementation(async () => [
      { formId: "auth-release" },
      { formId: "dohs-release" },
    ]);

    const allowed = await route.POST(toggleRequest({ itemId: ITEM_ID, completed: true }));
    assert.equal(allowed.status, 200);
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
  });

  it("lets read/acknowledge items complete without any signature lookup", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Review Ready to Work Attendance Verification",
    }));

    const res = await route.POST(toggleRequest({ itemId: ITEM_ID, completed: true }));

    assert.equal(res.status, 200);
    assert.equal(mockSubmissionFindMany.mock.callCount(), 0);
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
  });

  it("never blocks unchecking an item (completed: false)", async () => {
    const res = await route.POST(toggleRequest({ itemId: ITEM_ID, completed: false }));

    assert.equal(res.status, 200);
    assert.equal(mockItemFindUnique.mock.callCount(), 0);
    assert.equal(mockSubmissionFindMany.mock.callCount(), 0);
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
    const call = mockProgressUpsert.mock.calls[0].arguments[0];
    assert.equal(call.update.completed, false);
  });

  it("keeps the staff override: teachers complete on a student's behalf unguarded", async () => {
    currentSession = mockTeacherSession();

    const res = await route.POST(
      toggleRequest({ itemId: ITEM_ID, completed: true, studentId: OTHER_STUDENT_ID }),
    );

    assert.equal(res.status, 200);
    assert.equal(mockAssertStaffCanManageStudent.mock.callCount(), 1);
    // Staff path must not run the signature guard at all.
    assert.equal(mockItemFindUnique.mock.callCount(), 0);
    assert.equal(mockSubmissionFindMany.mock.callCount(), 0);
    const call = mockProgressUpsert.mock.calls[0].arguments[0];
    assert.equal(call.where.studentId_itemId.studentId, OTHER_STUDENT_ID);
  });

  it("still forbids a student from targeting another student's checklist", async () => {
    const res = await route.POST(
      toggleRequest({ itemId: ITEM_ID, completed: true, studentId: OTHER_STUDENT_ID }),
    );

    assert.equal(res.status, 403);
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
  });
});
