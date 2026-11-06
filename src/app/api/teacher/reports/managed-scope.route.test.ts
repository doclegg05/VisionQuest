import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { matchesWhere, mockTeacherSession } from "@/lib/test-helpers";

// The grant-KPI and outcomes reports scope their rows to the caller's managed
// student ids. An instructor with no class, or one naming another instructor's
// class, manages nobody: the report must come back empty, never program-wide.
// The fakes apply each `where` the way Postgres would (matchesWhere), and
// @/lib/classroom is real, so the scope under test is the production one.

let session: Session | null = null;

function classRow(id: string, instructorId: string) {
  return { id, instructors: [{ instructorId }], region: null };
}
function student(id: string, cls: ReturnType<typeof classRow>) {
  return {
    id,
    role: "student",
    isActive: true,
    classEnrollments: [{ status: "active", classId: cls.id, class: cls }],
  };
}
const classA = classRow("class-a", "teacher-a");
const classB = classRow("class-b", "teacher-b");
const STUDENTS = [student("sa", classA), student("sb", classB)];

function spokesRecord(studentId: string) {
  return {
    id: `rec-${studentId}`,
    studentId,
    firstName: "Student",
    lastName: studentId.toUpperCase(),
    status: "enrolled",
    referralDate: new Date("2025-09-01T12:00:00.000Z"),
    enrolledAt: new Date("2025-09-15T12:00:00.000Z"),
    unsubsidizedEmploymentAt: null,
    hourlyWage: null,
    postSecondaryEnteredAt: null,
    employmentFollowUps: [],
  };
}
const RECORDS = [spokesRecord("sa"), spokesRecord("sb")];

type FindArgs = { where: Record<string, unknown> };

mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/logger", {
  namedExports: { logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() } },
});
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findMany: async ({ where }: FindArgs) =>
          STUDENTS.filter((row) => matchesWhere(row, where)).map((row) => ({ id: row.id })),
      },
      spokesRecord: {
        findMany: async ({ where }: FindArgs) => RECORDS.filter((row) => matchesWhere(row, where)),
      },
      orientationItem: { count: async () => 0 },
      application: { findMany: async () => [] },
      opportunity: { count: async () => 0 },
      careerEvent: { findMany: async () => [] },
    },
    prismaAdmin: {},
  },
});

let grantKpi: typeof import("./grant-kpi/route").GET;
let grantKpiStudents: typeof import("./grant-kpi/students/route").GET;
let outcomes: typeof import("./outcomes/route").GET;

before(async () => {
  ({ GET: grantKpi } = await import("./grant-kpi/route"));
  ({ GET: grantKpiStudents } = await import("./grant-kpi/students/route"));
  ({ GET: outcomes } = await import("./outcomes/route"));
});

const noClassTeacher = mockTeacherSession({ id: "teacher-none" });
const teacherA = mockTeacherSession({ id: "teacher-a" });

function get(path: string): Request {
  return new Request(`http://localhost${path}`);
}

async function enrollmentDenominator(viewer: Session, query = ""): Promise<number> {
  session = viewer;
  const res = await grantKpi(get(`/api/teacher/reports/grant-kpi?programYear=PY2026${query}`));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { metrics: { enrollmentRate: { denominator: number } } };
  return body.metrics.enrollmentRate.denominator;
}

async function drillDownNames(viewer: Session, query = ""): Promise<string[]> {
  session = viewer;
  const res = await grantKpiStudents(
    get(`/api/teacher/reports/grant-kpi/students?metric=enrollment&programYear=PY2026${query}`),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { count: number; students: Array<{ name: string }> };
  assert.equal(body.count, body.students.length);
  return body.students.map((row) => row.name);
}

describe("GET /api/teacher/reports/grant-kpi", () => {
  it("counts only the instructor's own students", async () => {
    assert.equal(await enrollmentDenominator(teacherA), 1);
  });

  it("is empty for an instructor with no class", async () => {
    assert.equal(await enrollmentDenominator(noClassTeacher), 0);
  });

  it("is empty for an instructor naming another instructor's class", async () => {
    assert.equal(await enrollmentDenominator(teacherA, "&classId=class-b"), 0);
  });
});

describe("GET /api/teacher/reports/grant-kpi/students", () => {
  it("names only the instructor's own students", async () => {
    assert.deepEqual(await drillDownNames(teacherA), ["Student SA"]);
  });

  it("names nobody for an instructor with no class", async () => {
    assert.deepEqual(await drillDownNames(noClassTeacher), []);
  });

  it("names nobody for an instructor naming another instructor's class", async () => {
    assert.deepEqual(await drillDownNames(teacherA, "&classId=class-b"), []);
  });
});

describe("GET /api/teacher/reports/outcomes", () => {
  it("returns an empty report for an instructor with no students", async () => {
    session = noClassTeacher;
    const res = await outcomes();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { summary: { totalStudents: number }; attentionQueue: unknown[] };
    assert.equal(body.summary.totalStudents, 0);
    assert.deepEqual(body.attentionQueue, []);
  });
});
