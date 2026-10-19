/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

// GET /api/teacher/classes hands every teacher the list of active teachers so
// the class form can offer them as co-instructors. The demo instructor is a
// teacher row, and the other rows in that list are real people (names and
// emails), so the demo instructor gets an empty list instead.

let session: Session = mockTeacherSession();

const mockListManagedClasses = mock.fn() as any;
const mockClassFindMany = mock.fn() as any;
const mockStudentFindMany = mock.fn() as any;

mock.module("@/lib/api-error", {
  exports: {
    forbidden: (message = "Forbidden") => new Error(message),
    badRequest: (message: string) => new Error(message),
    conflict: (message: string) => new Error(message),
  },
});

mock.module("@/lib/registry/middleware", {
  exports: {
    withRegistry:
      (
        _toolId: string,
        handler: (
          sessionArg: Session,
          req: Request,
          ctx: { params: Promise<Record<string, string>> },
          tool: unknown,
        ) => Promise<Response>,
      ) =>
      async (req: Request, ctx: { params: Promise<Record<string, string>> }) =>
        handler(session, req, ctx, { id: "classes.list" }),
  },
});

mock.module("@/lib/classroom", {
  exports: {
    assertTeacherAssignmentLimit: async () => undefined,
    listManagedClasses: mockListManagedClasses,
    normalizeClassCode: (value: string) => value,
    normalizeInstructorIds: (ids: string[]) => ids,
  },
});

mock.module("@/lib/db", {
  exports: {
    prisma: {
      spokesClass: { findMany: mockClassFindMany },
      student: { findMany: mockStudentFindMany },
    },
  },
});

mock.module("@/lib/audit", { exports: { logAuditEvent: async () => undefined } });

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

const classRow = {
  id: "class-1",
  name: "Cohort Demo Class",
  code: "cohort-demo",
  status: "active",
  programType: "spokes",
  description: null,
  startDate: null,
  endDate: null,
  instructors: [{ instructor: { id: "demo-1", displayName: "Demo Instructor", email: null, role: "teacher" } }],
  enrollments: [{ id: "e-1", status: "active" }],
};
const teacherRows = [
  { id: "t-1", studentId: "real-teacher", displayName: "Real Teacher", email: "real@example.org" },
];

async function getClasses() {
  const response = await route.GET(
    mockRequest("/api/teacher/classes") as any,
    { params: Promise.resolve({}) },
  );
  assert.equal(response.status, 200);
  return (await response.json()) as { classes: Array<{ id: string }>; availableInstructors: unknown[] };
}

beforeEach(() => {
  mockListManagedClasses.mock.resetCalls();
  mockClassFindMany.mock.resetCalls();
  mockStudentFindMany.mock.resetCalls();
  mockListManagedClasses.mock.mockImplementation(async () => [{ id: "class-1" }]);
  mockClassFindMany.mock.mockImplementation(async () => [classRow]);
  mockStudentFindMany.mock.mockImplementation(async () => teacherRows);
});

describe("GET /api/teacher/classes", () => {
  it("returns no available instructors to the demo instructor", async () => {
    session = mockTeacherSession({ demoAccount: "instructor" });
    const body = await getClasses();

    assert.deepEqual(body.availableInstructors, []);
    assert.equal(mockStudentFindMany.mock.callCount(), 0, "the teacher list is not even queried");
    // The rest of the response keeps its shape: the demo class still shows.
    assert.deepEqual(body.classes.map((item) => item.id), ["class-1"]);
  });

  it("still lists the active teachers for a real teacher", async () => {
    session = mockTeacherSession();
    const body = await getClasses();

    assert.deepEqual(body.availableInstructors, teacherRows);
    assert.equal(mockStudentFindMany.mock.callCount(), 1);
  });
});
