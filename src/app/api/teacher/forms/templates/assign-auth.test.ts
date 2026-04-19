/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockAssertStaffCanManageStudent = mock.fn() as any;
const mockTemplateFindUnique = mock.fn() as any;
const mockAssignmentCreate = mock.fn() as any;

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
    notFound: (message: string) => makeHttpError(404, message),
    forbidden: (message: string) => makeHttpError(403, message),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageClass: mockAssertStaffCanManageClass,
    assertStaffCanManageStudent: mockAssertStaffCanManageStudent,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      formTemplate: { findUnique: mockTemplateFindUnique },
      formAssignment: { create: mockAssignmentCreate },
    },
  },
});

let route: Awaited<typeof import("./[id]/assign/route")>;

before(async () => {
  route = await import("./[id]/assign/route");
});

describe("POST /api/teacher/forms/templates/[id]/assign — authorization", () => {
  beforeEach(() => {
    mockAssertStaffCanManageClass.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();
    mockTemplateFindUnique.mock.resetCalls();
    mockAssignmentCreate.mock.resetCalls();

    mockTemplateFindUnique.mock.mockImplementation(async () => ({
      id: "tpl1",
      status: "active",
    }));
    mockAssignmentCreate.mock.mockImplementation(async () => ({
      id: "asg1",
      scope: "class",
      targetId: "cls1",
      dueAt: null,
      requiredForCompletion: false,
      createdAt: new Date(),
    }));
    mockAssertStaffCanManageClass.mock.mockImplementation(async () => ({ id: "cls1" }));
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => ({ id: "stu1" }));
  });

  it("creates a class-scope assignment after authorizing the class", async () => {
    const req = mockRequest("/api/teacher/forms/templates/tpl1/assign", {
      method: "POST",
      body: { scope: "class", targetId: "cls1" },
    });
    const res = await route.POST(req as never, { params: Promise.resolve({ id: "tpl1" }) });
    assert.equal(res.status, 201);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 1);
    assert.equal(mockAssertStaffCanManageStudent.mock.callCount(), 0);
    assert.equal(mockAssignmentCreate.mock.callCount(), 1);
  });

  it("returns 403 when the teacher does not manage the class", async () => {
    mockAssertStaffCanManageClass.mock.mockImplementationOnce(async () => {
      throw makeHttpError(403, "You do not have access to this class.");
    });
    const req = mockRequest("/api/teacher/forms/templates/tpl1/assign", {
      method: "POST",
      body: { scope: "class", targetId: "cls-other" },
    });
    const res = await route.POST(req as never, { params: Promise.resolve({ id: "tpl1" }) });
    assert.equal(res.status, 403);
    assert.equal(mockAssignmentCreate.mock.callCount(), 0);
  });

  it("returns 400 when the template is archived", async () => {
    mockTemplateFindUnique.mock.mockImplementationOnce(async () => ({ id: "tpl1", status: "archived" }));
    const req = mockRequest("/api/teacher/forms/templates/tpl1/assign", {
      method: "POST",
      body: { scope: "class", targetId: "cls1" },
    });
    const res = await route.POST(req as never, { params: Promise.resolve({ id: "tpl1" }) });
    assert.equal(res.status, 400);
    assert.equal(mockAssignmentCreate.mock.callCount(), 0);
  });

  it("returns 400 for malformed body (invalid scope)", async () => {
    const req = mockRequest("/api/teacher/forms/templates/tpl1/assign", {
      method: "POST",
      body: { scope: "global", targetId: "cls1" },
    });
    const res = await route.POST(req as never, { params: Promise.resolve({ id: "tpl1" }) });
    assert.equal(res.status, 400);
    assert.equal(mockAssignmentCreate.mock.callCount(), 0);
  });

  it("authorizes via assertStaffCanManageStudent on student-scope", async () => {
    const req = mockRequest("/api/teacher/forms/templates/tpl1/assign", {
      method: "POST",
      body: { scope: "student", targetId: "stu1" },
    });
    const res = await route.POST(req as never, { params: Promise.resolve({ id: "tpl1" }) });
    assert.equal(res.status, 201);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 0);
    assert.equal(mockAssertStaffCanManageStudent.mock.callCount(), 1);
  });
});
