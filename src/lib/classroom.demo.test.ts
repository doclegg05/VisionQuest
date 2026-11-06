import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

// The prisma-backed helpers in classroom.ts, run for the demo instructor and
// for a real teacher against a mock client. classroom.test.ts covers the pure
// where-clause builder; it cannot also mock the database, because it imports
// classroom.ts statically and the mock has to be in place first.
//
// Together they pin the organization tree: a real teacher and the demo
// instructor are held to classes they instruct, a regional coordinator to the
// classes in their regions, and admins and program coordinators see every class.

const mockClassFindMany = mock.fn<(args: Record<string, unknown>) => Promise<unknown[]>>(
  async () => [],
);
const mockClassFindFirst = mock.fn<(args: Record<string, unknown>) => Promise<unknown>>(
  async () => ({ id: "class-1", name: "Class", code: "class", status: "active" }),
);
const mockStudentFindFirst = mock.fn<(args: Record<string, unknown>) => Promise<unknown>>(
  async () => ({ id: "student-1" }),
);
const mockStudentFindMany = mock.fn<(args: Record<string, unknown>) => Promise<unknown[]>>(
  async () => [],
);

mock.module("@/lib/db", {
  exports: {
    prisma: {
      spokesClass: { findMany: mockClassFindMany, findFirst: mockClassFindFirst },
      student: { findFirst: mockStudentFindFirst, findMany: mockStudentFindMany },
    },
  },
});

let classroom: typeof import("./classroom");

before(async () => {
  classroom = await import("./classroom");
});

const demoInstructor: Session = {
  id: "demo-instructor-1",
  studentId: "demo-instructor",
  displayName: "Demo Instructor",
  role: "teacher",
  demoAccount: "instructor",
};
const realTeacher: Session = {
  id: "teacher-1",
  studentId: "teacher-1",
  displayName: "Teacher",
  role: "teacher",
};
const regionalCoordinator: Session = {
  id: "coord-1",
  studentId: "coord-1",
  displayName: "Coordinator",
  role: "coordinator",
};
const programCoordinator: Session = {
  id: "pc-1",
  studentId: "pc-1",
  displayName: "Program Coordinator",
  role: "program_coordinator",
};
const regionClause = (id: string) => ({ region: { coordinators: { some: { coordinatorId: id } } } });
const instructorsClause = (id: string) => ({ instructors: { some: { instructorId: id } } });

function firstWhere(fn: { mock: { calls: Array<{ arguments: [Record<string, unknown>] }> } }) {
  return fn.mock.calls[0].arguments[0].where as Record<string, unknown>;
}

beforeEach(() => {
  mockClassFindMany.mock.resetCalls();
  mockClassFindFirst.mock.resetCalls();
  mockStudentFindFirst.mock.resetCalls();
  mockStudentFindMany.mock.resetCalls();
});

describe("listManagedClasses", () => {
  it("lists only the classes a demo instructor teaches", async () => {
    await classroom.listManagedClasses(demoInstructor);
    assert.deepEqual(firstWhere(mockClassFindMany), {
      status: { not: "archived" },
      ...instructorsClause(demoInstructor.id),
    });
  });

  it("lists only the classes a real teacher teaches", async () => {
    await classroom.listManagedClasses(realTeacher);
    assert.deepEqual(firstWhere(mockClassFindMany), {
      status: { not: "archived" },
      ...instructorsClause(realTeacher.id),
    });
  });

  it("lists only the classes in a regional coordinator's regions", async () => {
    await classroom.listManagedClasses(regionalCoordinator);
    assert.deepEqual(firstWhere(mockClassFindMany), {
      status: { not: "archived" },
      ...regionClause(regionalCoordinator.id),
    });
  });

  it("lists every non-archived class for a program coordinator by default", async () => {
    await classroom.listManagedClasses(programCoordinator);
    assert.deepEqual(firstWhere(mockClassFindMany), { status: { not: "archived" } });
  });

  it("lists every class for a program coordinator", async () => {
    await classroom.listManagedClasses(programCoordinator, { includeArchived: true });
    assert.deepEqual(firstWhere(mockClassFindMany), {});
  });
});

describe("assertStaffCanManageClass", () => {
  it("looks a class up through the instructors clause for the demo instructor", async () => {
    await classroom.assertStaffCanManageClass(demoInstructor, "class-1");
    assert.deepEqual(firstWhere(mockClassFindFirst), {
      id: "class-1",
      ...instructorsClause(demoInstructor.id),
    });
  });

  it("refuses a class the demo instructor does not teach", async () => {
    mockClassFindFirst.mock.mockImplementationOnce(async () => null);
    await assert.rejects(
      () => classroom.assertStaffCanManageClass(demoInstructor, "someone-elses-class"),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
  });

  it("looks a class up through the instructors clause for a real teacher", async () => {
    await classroom.assertStaffCanManageClass(realTeacher, "class-1");
    assert.deepEqual(firstWhere(mockClassFindFirst), {
      id: "class-1",
      ...instructorsClause(realTeacher.id),
    });
  });

  it("looks a class up through the region clause for a regional coordinator", async () => {
    await classroom.assertStaffCanManageClass(regionalCoordinator, "class-1");
    assert.deepEqual(firstWhere(mockClassFindFirst), {
      id: "class-1",
      ...regionClause(regionalCoordinator.id),
    });
  });

  it("keeps a program coordinator's class lookup unscoped", async () => {
    await classroom.assertStaffCanManageClass(programCoordinator, "class-1");
    assert.deepEqual(firstWhere(mockClassFindFirst), { id: "class-1" });
  });
});

describe("student lookups", () => {
  it("narrows assertStaffCanManageStudent to the demo instructor's classes", async () => {
    await classroom.assertStaffCanManageStudent(demoInstructor, "student-1");
    const where = firstWhere(mockStudentFindFirst) as { AND: Array<Record<string, unknown>> };
    const managed = where.AND[1] as {
      classEnrollments: { some: { class: unknown } };
    };
    assert.deepEqual(managed.classEnrollments.some.class, instructorsClause(demoInstructor.id));
  });

  it("refuses a student outside the demo instructor's classes", async () => {
    mockStudentFindFirst.mock.mockImplementationOnce(async () => null);
    await assert.rejects(
      () => classroom.assertStaffCanManageStudent(demoInstructor, "real-student"),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
  });

  it("narrows listManagedStudentIds to the demo instructor's classes", async () => {
    await classroom.listManagedStudentIds(demoInstructor);
    const where = firstWhere(mockStudentFindMany) as {
      classEnrollments: { some: { class: unknown } };
    };
    assert.deepEqual(where.classEnrollments.some.class, instructorsClause(demoInstructor.id));
  });

  it("narrows a real teacher's student lookups to the classes they teach", async () => {
    await classroom.listManagedStudentIds(realTeacher);
    const where = firstWhere(mockStudentFindMany) as {
      classEnrollments: { some: { class: unknown } };
    };
    assert.deepEqual(where.classEnrollments.some.class, instructorsClause(realTeacher.id));
  });

  it("keeps a program coordinator's student lookups unscoped", async () => {
    await classroom.listManagedStudentIds(programCoordinator);
    assert.deepEqual(firstWhere(mockStudentFindMany), { role: "student" });
  });
});
