/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const regionInstructorCount = mock.fn(async (_args?: unknown) => 0) as any;
const classInstructorCount = mock.fn(async (_args?: unknown) => 0) as any;
const regionInstructorUpsert = mock.fn(async (_args?: unknown) => ({})) as any;
const regionInstructorDelete = mock.fn(async (_args?: unknown) => ({})) as any;
const studentFindMany = mock.fn(async (_args?: unknown) => [] as unknown[]) as any;
const studentFindFirst = mock.fn(async (_args?: unknown) => ({ id: "t1" }) as unknown) as any;
const classFindMany = mock.fn(async (_args?: unknown) => [] as unknown[]) as any;
const regionCount = mock.fn(async (_args?: unknown) => 1) as any;
const auditCalls: unknown[] = [];
const coordinatorHasRegion = mock.fn(async () => true) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {},
    prismaAdmin: {
      regionInstructor: {
        count: regionInstructorCount,
        upsert: regionInstructorUpsert,
        deleteMany: regionInstructorDelete,
      },
      spokesClassInstructor: { count: classInstructorCount },
      student: { findMany: studentFindMany, findFirst: studentFindFirst },
      spokesClass: { findMany: classFindMany },
      region: { count: regionCount },
    },
  },
});
mock.module("@/lib/audit", {
  namedExports: {
    tryLogAuditEvent: async (input: unknown) => {
      auditCalls.push(input);
      return { audited: true };
    },
  },
});
mock.module("@/lib/region", { namedExports: { coordinatorHasRegion } });

let mod: typeof import("./org-placement");

const admin = { id: "a1", studentId: "a", displayName: "A", role: "admin" };
const regional = { id: "c1", studentId: "c", displayName: "C", role: "coordinator" };
const teacher = { id: "t1", studentId: "t", displayName: "T", role: "teacher" };

before(async () => {
  mod = await import("./org-placement");
});

beforeEach(() => {
  for (const fn of [regionInstructorCount, classInstructorCount, regionInstructorUpsert, studentFindMany, coordinatorHasRegion]) {
    fn.mock.resetCalls();
  }
  regionInstructorCount.mock.mockImplementation(async () => 0);
  classInstructorCount.mock.mockImplementation(async () => 0);
  coordinatorHasRegion.mock.mockImplementation(async () => true);
  auditCalls.length = 0;
});

describe("isUnplacedInstructor", () => {
  it("is false for a teacher with a class but no region", async () => {
    // The query demands no region AND no class, so a teacher with a class matches nothing.
    studentFindFirst.mock.mockImplementationOnce(async () => null);
    assert.equal(await mod.isUnplacedInstructor("t1"), false);
  });

  it("is true for a teacher with neither a region nor a class", async () => {
    assert.equal(await mod.isUnplacedInstructor("t1"), true);
    const where = (studentFindFirst.mock.calls.at(-1)?.arguments[0] as any).where;
    assert.equal(where.id, "t1");
    assert.equal(where.role, "teacher");
    assert.deepEqual(where.instructorRegions, { none: {} });
    assert.deepEqual(where.instructedClasses, { none: {} });
  });
});

describe("lists", () => {
  it("refuses a regional coordinator the applicants list", async () => {
    await assert.rejects(() => mod.listApplicantsWaiting(regional), /Forbidden|forbidden|access/i);
    assert.equal(studentFindMany.mock.callCount(), 0);
  });

  it("refuses an instructor the unplaced staff list", async () => {
    await assert.rejects(() => mod.listUnplacedStaff(teacher));
  });

  it("asks only for students with no non-archived enrollment", async () => {
    await mod.listApplicantsWaiting(admin);
    const where = (studentFindMany.mock.calls[0].arguments[0] as any).where;
    assert.equal(where.role, "student");
    assert.deepEqual(where.classEnrollments, { none: { status: { not: "archived" } } });
  });

  it("asks only for teachers with no region and no class", async () => {
    await mod.listUnplacedStaff(admin);
    const where = (studentFindMany.mock.calls[0].arguments[0] as any).where;
    assert.equal(where.role, "teacher");
    assert.deepEqual(where.instructorRegions, { none: {} });
    assert.deepEqual(where.instructedClasses, { none: {} });
  });
});

describe("listUnregionedClasses", () => {
  beforeEach(() => {
    classFindMany.mock.resetCalls();
    classFindMany.mock.mockImplementation(async () => []);
  });

  it("refuses a regional coordinator and an instructor, and reads nothing", async () => {
    await assert.rejects(() => mod.listUnregionedClasses(regional), /Forbidden|forbidden|access/i);
    await assert.rejects(() => mod.listUnregionedClasses(teacher));
    assert.equal(classFindMany.mock.callCount(), 0);
  });

  it("asks only for non-archived classes with no region, with an explicit field set", async () => {
    await mod.listUnregionedClasses(admin);
    const args = classFindMany.mock.calls[0].arguments[0] as any;
    assert.deepEqual(args.where, { regionId: null, status: { not: "archived" } });
    assert.deepEqual(args.select, {
      id: true,
      name: true,
      _count: { select: { instructors: true, enrollments: { where: { status: "active" } } } },
    });
  });

  it("returns exactly id, name, instructorCount and activeStudents", async () => {
    classFindMany.mock.mockImplementation(async () => [
      { id: "k1", name: "Night", _count: { instructors: 2, enrollments: 7 } },
    ]);
    assert.deepEqual(await mod.listUnregionedClasses(admin), [
      { id: "k1", name: "Night", instructorCount: 2, activeStudents: 7 },
    ]);
  });
});

describe("assignInstructorRegion", () => {
  it("writes the RegionInstructor row and an audit row", async () => {
    await mod.assignInstructorRegion(admin, { instructorId: "t1", regionId: "r1" });
    assert.equal(regionInstructorUpsert.mock.callCount(), 1);
    const audit = auditCalls[0] as any;
    assert.equal(audit.action, "org_placement.assign_region");
    assert.equal(audit.targetId, "t1");
    assert.deepEqual(audit.metadata, { regionId: "r1" });
  });

  it("refuses a regional coordinator outside their region", async () => {
    coordinatorHasRegion.mock.mockImplementation(async () => false);
    await assert.rejects(() => mod.assignInstructorRegion(regional, { instructorId: "t1", regionId: "r9" }));
    assert.equal(regionInstructorUpsert.mock.callCount(), 0);
  });

  it("refuses an instructor", async () => {
    await assert.rejects(() => mod.assignInstructorRegion(teacher, { instructorId: "t1", regionId: "r1" }));
  });

  it("refuses an account that is not an instructor", async () => {
    studentFindFirst.mock.mockImplementationOnce(async () => null);
    await assert.rejects(() => mod.assignInstructorRegion(admin, { instructorId: "s1", regionId: "r1" }));
    assert.equal(regionInstructorUpsert.mock.callCount(), 0);
  });

  it("limits a regional coordinator to unplaced instructors or ones already in their regions", async () => {
    await mod.assignInstructorRegion(regional, { instructorId: "t1", regionId: "r1" });
    const where = (studentFindFirst.mock.calls.at(-1)?.arguments[0] as any).where;
    assert.equal(where.id, "t1");
    assert.equal(where.role, "teacher");
    assert.deepEqual(where.OR, [
      { instructorRegions: { none: {} }, instructedClasses: { none: {} } },
      { instructorRegions: { some: { region: { coordinators: { some: { coordinatorId: "c1" } } } } } },
    ]);
  });

  it("refuses a regional coordinator an instructor placed in another region", async () => {
    // The scoped lookup matches nothing for an instructor placed only outside the caller's regions.
    studentFindFirst.mock.mockImplementationOnce(async () => null);
    await assert.rejects(() => mod.assignInstructorRegion(regional, { instructorId: "t9", regionId: "r1" }));
    assert.equal(regionInstructorUpsert.mock.callCount(), 0);
  });

  it("does not limit a whole-state caller to unplaced instructors", async () => {
    await mod.assignInstructorRegion(admin, { instructorId: "t1", regionId: "r1" });
    const where = (studentFindFirst.mock.calls.at(-1)?.arguments[0] as any).where;
    assert.equal(where.OR, undefined);
  });
});
