/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockAdminSession, mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const TEACHER_ID = "cteacher000000000000001";
const OTHER_ID = "cteacher000000000000002";
const REGION_A = "cregion0000000000000001";
const REGION_B = "cregion0000000000000002";

const session = mockTeacherSession({ id: TEACHER_ID });
let currentSession = session;

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockAssertTeacherAssignmentLimit = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockFindFirst = mock.fn() as any;
const mockCount = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockRegionInstructorFindMany = mock.fn() as any;
const mockRegionInstructorCount = mock.fn() as any;
const mockRegionFindUnique = mock.fn() as any;
// The class insert runs inside prismaAdmin.$transaction (Ruling R19): the
// RLS client's WITH CHECK cannot pass for a class with no instructor row yet.
const mockClassCreate = mock.fn() as any;
const mockInstructorCreateMany = mock.fn() as any;
const mockAdminCodeLookup = mock.fn() as any;
const mockAdminTransaction = mock.fn() as any;
const mockRlsClassCreate = mock.fn() as any;

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
    conflict: (message: string) => makeHttpError(409, message),
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
  },
});

mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (_toolId: string, handler: (...args: any[]) => Promise<Response>) =>
      async (req: unknown, ctx: unknown) => {
        try {
          return await handler(currentSession, req, ctx, {});
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageClass: mockAssertStaffCanManageClass,
    assertTeacherAssignmentLimit: mockAssertTeacherAssignmentLimit,
    listManagedClasses: async () => [],
    normalizeClassCode: (value: string) => value.trim().toLowerCase(),
    normalizeInstructorIds: (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))],
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      regionInstructor: { count: mockRegionInstructorCount },
      $transaction: mockAdminTransaction,
    },
    prisma: {
      spokesClass: {
        findUnique: mockFindUnique,
        findFirst: mockFindFirst,
        create: mockRlsClassCreate,
      },
      region: { findUnique: mockRegionFindUnique },
      regionInstructor: { findMany: mockRegionInstructorFindMany },
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
let classesRoute: Awaited<typeof import("./route")>;

before(async () => {
  classRoute = await import("./[id]/route");
  classesRoute = await import("./route");
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
    currentSession = session;
    mockRegionInstructorFindMany.mock.mockImplementation(async () => [{ regionId: REGION_A }]);
    mockRegionFindUnique.mock.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: "active",
    }));
  });

  async function patchRegion(regionId: string) {
    const req = mockRequest("/api/teacher/classes/class-1", { method: "PATCH", body: { regionId } });
    const res = await classRoute.PATCH(req as never, { params: Promise.resolve({ id: "class-1" }) });
    return { res, body: await res.json() };
  }

  it("refuses a teacher moving their class to a region they are not in", async () => {
    const { res, body } = await patchRegion(REGION_B);
    assert.equal(res.status, 403);
    assert.equal(body.error, "You can put classrooms only in your own region.");
    assert.equal(mockTransaction.mock.callCount(), 0);
  });

  it("lets a teacher keep the class in a region they are in", async () => {
    // The class's other instructor, teacher-1, is in region A too.
    mockRegionInstructorCount.mock.mockImplementation(async () => 1);
    const { res } = await patchRegion(REGION_A);
    assert.equal(res.status, 200);
    assert.equal(mockTransaction.mock.callCount(), 1);
  });

  it("lets an admin move a class to any active region", async () => {
    currentSession = mockAdminSession();
    mockRegionInstructorFindMany.mock.mockImplementation(async () => []);
    const { res } = await patchRegion(REGION_B);
    assert.equal(res.status, 200);
    assert.equal(mockTransaction.mock.callCount(), 1);
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

describe("POST /api/teacher/classes region rules", () => {
  function createRequest(overrides: Record<string, unknown> = {}) {
    return mockRequest("/api/teacher/classes", {
      method: "POST",
      body: {
        name: "Morning class",
        instructorIds: [TEACHER_ID],
        programType: "spokes",
        regionId: REGION_A,
        ...overrides,
      },
    });
  }

  async function post(overrides: Record<string, unknown> = {}) {
    const res = await classesRoute.POST(createRequest(overrides) as never, {
      params: Promise.resolve({}),
    });
    return { res, body: await res.json() };
  }

  beforeEach(() => {
    currentSession = session;
    for (const fn of [
      mockFindUnique, mockCount, mockAssertTeacherAssignmentLimit, mockLogAuditEvent,
      mockRegionInstructorFindMany, mockRegionInstructorCount, mockRegionFindUnique, mockClassCreate,
      mockInstructorCreateMany, mockAdminCodeLookup, mockAdminTransaction, mockRlsClassCreate,
    ]) {
      fn.mock.resetCalls();
    }
    mockFindUnique.mock.mockImplementation(async () => null);
    mockCount.mock.mockImplementation(async () => 1);
    mockAssertTeacherAssignmentLimit.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockRegionInstructorFindMany.mock.mockImplementation(async () => [{ regionId: REGION_A }]);
    mockRegionInstructorCount.mock.mockImplementation(async () => 0);
    mockRegionFindUnique.mock.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: "active",
    }));
    mockAdminCodeLookup.mock.mockImplementation(async () => null);
    mockInstructorCreateMany.mock.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
    mockAdminTransaction.mock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        spokesClass: { findUnique: mockAdminCodeLookup, create: mockClassCreate },
        spokesClassInstructor: { createMany: mockInstructorCreateMany },
      }),
    );
    mockClassCreate.mock.mockImplementation(async () => ({
      id: "class-new",
      name: "Morning class",
      code: "morning class",
      status: "active",
      programType: "spokes",
      regionId: REGION_A,
    }));
  });

  it("refuses a teacher who belongs to no region", async () => {
    mockRegionInstructorFindMany.mock.mockImplementation(async () => []);
    const { res, body } = await post();
    assert.equal(res.status, 403);
    assert.equal(
      body.error,
      "Ask your regional coordinator to add you to a region before creating a classroom.",
    );
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });

  it("refuses a teacher creating in a region they are not in", async () => {
    const { res, body } = await post({ regionId: REGION_B });
    assert.equal(res.status, 403);
    assert.equal(body.error, "You can put classrooms only in your own region.");
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });

  it("requires a teacher to list themself as an instructor", async () => {
    const { res } = await post({ instructorIds: [OTHER_ID] });
    assert.equal(res.status, 400);
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });

  it("refuses a co-teacher who is not in the class's region", async () => {
    mockCount.mock.mockImplementation(async () => 2);
    mockRegionInstructorCount.mock.mockImplementation(async () => 0);
    const { res, body } = await post({ instructorIds: [TEACHER_ID, OTHER_ID] });
    assert.equal(res.status, 400);
    assert.equal(body.error, "Co-teachers must be in the same region.");
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });

  it("accepts a co-teacher who is in the region", async () => {
    mockCount.mock.mockImplementation(async () => 2);
    mockRegionInstructorCount.mock.mockImplementation(async () => 1);
    const { res, body } = await post({ instructorIds: [TEACHER_ID, OTHER_ID] });
    assert.equal(res.status, 200);
    assert.equal(body.class.id, "class-new");
  });

  it("lets an admin create in any active region", async () => {
    currentSession = mockAdminSession();
    mockRegionInstructorFindMany.mock.mockImplementation(async () => []);
    mockRegionInstructorCount.mock.mockImplementation(async () => 1);
    const { res, body } = await post({ regionId: REGION_B, instructorIds: [OTHER_ID] });
    assert.equal(res.status, 200);
    assert.equal(body.class.id, "class-new");
  });

  it("refuses an archived region even for an admin", async () => {
    currentSession = mockAdminSession();
    mockRegionFindUnique.mock.mockImplementation(async () => ({ id: REGION_B, status: "archived" }));
    const { res } = await post({ regionId: REGION_B, instructorIds: [OTHER_ID] });
    assert.equal(res.status, 400);
  });

  it("answers 400 when regionId is missing", async () => {
    const { res } = await post({ regionId: undefined });
    assert.equal(res.status, 400);
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });

  it("writes the class and its instructor rows in one admin transaction, never through the RLS client", async () => {
    const { res } = await post();
    assert.equal(res.status, 200);
    assert.equal(mockAdminTransaction.mock.callCount(), 1);
    assert.equal(mockClassCreate.mock.callCount(), 1);
    assert.equal(mockRlsClassCreate.mock.callCount(), 0);
    const rows = mockInstructorCreateMany.mock.calls[0]?.arguments[0] as {
      data: Array<{ classId: string; instructorId: string }>;
    };
    assert.deepEqual(rows.data, [{ classId: "class-new", instructorId: TEACHER_ID }]);
  });

  it("opens no admin transaction until every check has passed", async () => {
    await post({ regionId: REGION_B });
    await post({ instructorIds: [OTHER_ID] });
    // The assignment limit is checked inside the transaction (see
    // "still enforces the two-active-classes limit"), not before it.
    assert.equal(mockAdminTransaction.mock.callCount(), 0);
    assert.equal(mockRlsClassCreate.mock.callCount(), 0);
  });

  it("checks the class code against every class, not only the ones RLS lets a teacher see", async () => {
    mockAdminCodeLookup.mock.mockImplementation(async () => ({ id: "someone-elses-class" }));
    const { res, body } = await post();
    assert.equal(res.status, 409);
    assert.equal(body.error, "That class code is already in use.");
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });

  it("still enforces the two-active-classes limit", async () => {
    mockAssertTeacherAssignmentLimit.mock.mockImplementation(async () => {
      throw makeHttpError(409, "limit");
    });
    const { res, body } = await post();
    assert.equal(res.status, 409);
    assert.equal(body.error, "limit");
    assert.equal(mockClassCreate.mock.callCount(), 0);
  });
});
