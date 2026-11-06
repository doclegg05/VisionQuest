/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession } from "@/lib/test-helpers";

const mockClassFindMany = mock.fn() as any;
const mockClassFindUnique = mock.fn() as any;
const mockEnrollmentFindMany = mock.fn() as any;
const mockOrientationCount = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      spokesClass: { findMany: mockClassFindMany, findUnique: mockClassFindUnique },
      studentClassEnrollment: { findMany: mockEnrollmentFindMany },
      orientationItem: { count: mockOrientationCount },
    },
    prismaAdmin: {},
  },
});

let drilldown: typeof import("./drilldown");

before(async () => {
  drilldown = await import("./drilldown");
});

const REGION_ID = "clv9q1x2h000008l3f4g5h6i7";

beforeEach(() => {
  for (const m of [mockClassFindMany, mockClassFindUnique, mockEnrollmentFindMany, mockOrientationCount]) {
    m.mock.resetCalls();
  }
  mockOrientationCount.mock.mockImplementation(async () => 2);
});

describe("regionOverview", () => {
  it("groups the region's classes under their instructors", async () => {
    mockClassFindMany.mock.mockImplementation(async () => [
      {
        id: "c1",
        name: "Morning",
        instructors: [{ instructor: { id: "i1", displayName: "Ada" } }],
        _count: { enrollments: 4 },
      },
      {
        id: "c2",
        name: "Evening",
        instructors: [{ instructor: { id: "i1", displayName: "Ada" } }],
        _count: { enrollments: 2 },
      },
      {
        id: "c3",
        name: "Night",
        instructors: [{ instructor: { id: "i2", displayName: "Bo" } }],
        _count: { enrollments: 0 },
      },
    ]);

    const result = await drilldown.regionOverview(mockTeacherSession({ role: "coordinator" }), REGION_ID);

    assert.deepEqual(result, {
      instructors: [
        {
          id: "i1",
          displayName: "Ada",
          classes: [
            { id: "c1", name: "Morning", activeStudents: 4 },
            { id: "c2", name: "Evening", activeStudents: 2 },
          ],
        },
        { id: "i2", displayName: "Bo", classes: [{ id: "c3", name: "Night", activeStudents: 0 }] },
      ],
    });
  });

  it("reads only non-archived classes of the named region and counts active enrollments", async () => {
    mockClassFindMany.mock.mockImplementation(async () => []);
    await drilldown.regionOverview(mockTeacherSession({ role: "coordinator" }), REGION_ID);
    const args = mockClassFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(args.where, { regionId: REGION_ID, status: { not: "archived" } });
    assert.deepEqual(args.select._count, {
      select: { enrollments: { where: { status: "active" } } },
    });
  });
});

describe("classRoster", () => {
  const enrolledAt = new Date("2026-09-01T00:00:00Z");

  function enrollment(overrides: Record<string, unknown> = {}) {
    return {
      enrolledAt,
      student: {
        id: "s1",
        displayName: "Sam",
        progression: null,
        orientationProgress: [{ completed: true }, { completed: true }],
        goals: [
          { status: "active" },
          { status: "completed" },
          { status: "proposed" },
          { status: "abandoned" },
        ],
      },
      ...overrides,
    };
  }

  it("returns exactly the roster keys and no transcript, mood, crisis or chat fields", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [enrollment()]);
    const result = await drilldown.classRoster(mockTeacherSession({ role: "coordinator" }), "c1");
    assert.deepEqual(Object.keys(result), ["students"]);
    assert.deepEqual(Object.keys(result.students[0]).sort(), [
      "displayName",
      "enrolledAt",
      "goalsAchieved",
      "goalsSet",
      "id",
      "orientationComplete",
    ]);
  });

  it("counts planning-status goals as set and completed goals as achieved", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [enrollment()]);
    const { students } = await drilldown.classRoster(mockTeacherSession({ role: "coordinator" }), "c1");
    assert.equal(students[0].goalsSet, 2, "active and completed count; proposed and abandoned do not");
    assert.equal(students[0].goalsAchieved, 1);
    assert.equal(students[0].enrolledAt.getTime(), enrolledAt.getTime());
  });

  it("marks orientation complete only when every item is done, or progression says so", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollment({
        student: {
          id: "s1", displayName: "A", progression: null, goals: [],
          orientationProgress: [{ completed: true }],
        },
      }),
      enrollment({
        student: {
          id: "s2", displayName: "B", progression: null, goals: [],
          orientationProgress: [{ completed: true }, { completed: true }],
        },
      }),
      enrollment({
        student: {
          id: "s3", displayName: "C", goals: [], orientationProgress: [],
          progression: { state: JSON.stringify({ orientationComplete: true }) },
        },
      }),
    ]);
    const { students } = await drilldown.classRoster(mockTeacherSession({ role: "coordinator" }), "c1");
    assert.deepEqual(students.map((s) => s.orientationComplete), [false, true, true]);
  });

  it("selects no conversation, mood, alert or file relations", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => []);
    await drilldown.classRoster(mockTeacherSession({ role: "coordinator" }), "c1");
    const args = mockEnrollmentFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(args.where, { classId: "c1", status: "active" });
    assert.deepEqual(Object.keys(args.select.student.select).sort(), [
      "displayName", "goals", "id", "orientationProgress", "progression",
    ]);
  });
});

describe("classAccess", () => {
  const coordinator = mockTeacherSession({ role: "coordinator" });
  it("reports a missing class as not found", async () => {
    mockClassFindUnique.mock.mockImplementation(async () => null);
    assert.deepEqual(await drilldown.findClassRegion("c1"), { found: false, regionId: null });
  });
  it("returns the class's region", async () => {
    mockClassFindUnique.mock.mockImplementation(async () => ({ regionId: REGION_ID }));
    assert.deepEqual(await drilldown.findClassRegion("c1"), { found: true, regionId: REGION_ID });
    void coordinator;
  });
});
