/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockAssertTeacherAssignmentLimit = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockFindFirst = mock.fn() as any;
const mockCount = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
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
    conflict: (message: string) => makeHttpError(409, message),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageClass: mockAssertStaffCanManageClass,
    assertTeacherAssignmentLimit: mockAssertTeacherAssignmentLimit,
    normalizeClassCode: (value: string) => value.trim().toLowerCase(),
    normalizeInstructorIds: (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))],
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      spokesClass: {
        findUnique: mockFindUnique,
        findFirst: mockFindFirst,
      },
      student: {
        count: mockCount,
      },
      $transaction: mockTransaction,
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let classRoute: Awaited<typeof import("./[id]/route")>;

before(async () => {
  classRoute = await import("./[id]/route");
});

describe("teacher class update authorization", () => {
  beforeEach(() => {
    mockAssertStaffCanManageClass.mock.resetCalls();
    mockAssertTeacherAssignmentLimit.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockFindFirst.mock.resetCalls();
    mockCount.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockFindUnique.mock.mockImplementation(async () => ({
      id: "class-1",
      name: "SPOKES",
      code: "spokes",
      status: "active",
      instructors: [{ instructorId: "teacher-1" }],
    }));
    mockFindFirst.mock.mockImplementation(async () => null);
    mockCount.mock.mockImplementation(async () => 1);
    mockTransaction.mock.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({
        spokesClass: { update: async () => undefined },
        spokesClassInstructor: {
          deleteMany: async () => undefined,
          createMany: async () => undefined,
        },
      });
    });
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockAssertStaffCanManageClass.mock.mockImplementation(async () => ({ id: "class-1" }));
    mockAssertTeacherAssignmentLimit.mock.mockImplementation(async () => undefined);
  });

  it("returns 403 and skips updates when the teacher does not manage the class", async () => {
    mockAssertStaffCanManageClass.mock.mockImplementationOnce(async () => {
      throw makeHttpError(403, "You do not have access to this class.");
    });

    const req = mockRequest("/api/teacher/classes/class-2", {
      method: "PATCH",
      body: { name: "Updated class" },
    });

    const res = await classRoute.PATCH(req as never, {
      params: Promise.resolve({ id: "class-2" }),
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.match(String(body.error), /do not have access/i);
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(mockAssertTeacherAssignmentLimit.mock.callCount(), 0);
  });
});
