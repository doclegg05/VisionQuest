/* eslint-disable @typescript-eslint/no-explicit-any -- the fake Prisma client stands in for many model signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Routes outside /api/teacher that serve both students and staff. A staff
 * read of a managed student's record writes one view row; a student reading
 * their own data writes none; a refused staff read writes none.
 *
 * As in src/app/api/teacher/staff-read-views.test.ts, only `@/lib/db` and
 * I/O helpers are faked. `assertStaffCanManageStudent` and
 * `recordStudentView` are the production code.
 */

const OWNER_TEACHER = "cteacherowner00000000001";
const OTHER_TEACHER = "cteacherother00000000001";
const ADMIN = "cadmin000000000000000001";
const STUDENT = { id: "cstudent0000000000000001", studentId: "learner1", displayName: "Ada", role: "student", isActive: true };
const FILE_ID = "cfile0000000000000000001";
const GOAL_ID = "cgoal0000000000000000001";

type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null = null;

const auditCreates: Array<{ action: string; targetId: string | null; actorId: string | null }> = [];

function managedStudentLookup(args: any) {
  const where = JSON.stringify(args?.where ?? {});
  const named = where.includes(`"${STUDENT.id}"`) || where.includes(`"${STUDENT.studentId}"`);
  if (!named) return null;
  const scopedToOwner = where.includes(`"instructorId":"${OWNER_TEACHER}"`);
  const unscoped = !where.includes('"classEnrollments"');
  return scopedToOwner || unscoped ? STUDENT : null;
}

const now = new Date("2026-11-10T12:00:00.000Z");
const fileRow = {
  id: FILE_ID,
  studentId: STUDENT.id,
  filename: "signed-form.pdf",
  storageKey: "uploads/k.pdf",
  mimeType: "application/pdf",
  category: "form",
};

const fakePrisma = {
  student: { findFirst: async (args: any) => managedStudentLookup(args) },
  fileUpload: {
    // Applies the student-only scope the route hands it, as Postgres would.
    findFirst: async (args: any) => (args.where.studentId && args.where.studentId !== STUDENT.id ? null : fileRow),
  },
  formSubmission: { findMany: async () => [] },
  orientationItem: { findMany: async () => [] },
  sageInsight: { findMany: async () => [] },
  goal: {
    findFirst: async () => ({ id: GOAL_ID, studentId: STUDENT.id, level: "monthly", content: "GED", status: "active", parentId: null, createdAt: now }),
  },
  goalResourceLink: { findMany: async () => [] },
};

const fakePrismaAdmin = {
  auditLog: {
    findFirst: async (args: any) =>
      auditCreates.find(
        (row) => row.actorId === args.where.actorId && row.action === args.where.action && row.targetId === args.where.targetId,
      ) ?? null,
    create: async (args: any) => {
      auditCreates.push(args.data);
      return { id: `audit-${auditCreates.length}` };
    },
  },
};

type GetHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const handlers: Record<string, GetHandler> = {};

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  mock.module("@/lib/db", { namedExports: { prisma: fakePrisma, prismaAdmin: fakePrismaAdmin } });
  mock.module("@/lib/storage", {
    namedExports: {
      getPresignedDownloadUrl: async () => "https://storage.example/file.pdf",
      downloadFile: async () => null,
    },
  });
  mock.module("@/lib/goal-plan", { namedExports: { buildGoalPlanEntries: async () => [] } });

  const load = async (path: string): Promise<GetHandler> => (await import(path)).GET as GetHandler;
  handlers.files = await load("./files/download/route");
  handlers.insights = await load("./sage/insights/route");
  handlers.orientation = await load("./orientation/route");
  handlers.formsStatus = await load("./forms/status/route");
  handlers.goalResources = await load("./goals/[id]/resources/route");
});

const teacher = (id: string): TestSession => ({ id, studentId: "t", displayName: "T", role: "teacher" });
const studentSession = (): TestSession => ({ id: STUDENT.id, studentId: STUDENT.studentId, displayName: "Ada", role: "student" });

beforeEach(() => {
  auditCreates.length = 0;
  session = teacher(OWNER_TEACHER);
});

const viewRows = () => auditCreates.filter((row) => row.action.startsWith("teacher.student.view."));

interface RouteCase {
  name: string;
  handler: string;
  surface: string;
  staffUrl: string;
  ownUrl: string;
  params?: Record<string, string>;
  okStatus?: number;
}

const ROUTES: RouteCase[] = [
  { name: "files/download", handler: "files", surface: "files", staffUrl: `/x?id=${FILE_ID}`, ownUrl: `/x?id=${FILE_ID}`, okStatus: 302 },
  { name: "sage/insights", handler: "insights", surface: "insights", staffUrl: `/x?studentId=${STUDENT.id}`, ownUrl: "/x" },
  { name: "orientation", handler: "orientation", surface: "orientation", staffUrl: `/x?studentId=${STUDENT.id}`, ownUrl: "/x" },
  { name: "forms/status", handler: "formsStatus", surface: "forms", staffUrl: `/x?studentId=${STUDENT.id}`, ownUrl: "/x" },
  { name: "goals/[id]/resources", handler: "goalResources", surface: "goal_resources", staffUrl: "/x", ownUrl: "/x", params: { id: GOAL_ID } },
];

function call(route: RouteCase, url: string): Promise<Response> {
  return handlers[route.handler](new Request(`http://localhost${url}`), { params: Promise.resolve(route.params ?? {}) });
}

for (const route of ROUTES) {
  describe(`GET /api/${route.name}`, () => {
    it(`a managing teacher writes one "${route.surface}" view for the student`, async () => {
      const res = await call(route, route.staffUrl);

      assert.equal(res.status, route.okStatus ?? 200);
      const rows = viewRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].action, `teacher.student.view.${route.surface}`);
      assert.equal(rows[0].targetId, STUDENT.id);
      assert.equal(rows[0].actorId, OWNER_TEACHER);
    });

    it("a student reading their own data writes no view", async () => {
      session = studentSession();

      const res = await call(route, route.ownUrl);

      assert.equal(res.status, route.okStatus ?? 200);
      assert.equal(viewRows().length, 0);
    });

    it("a teacher of another class is refused and writes no view", async () => {
      session = teacher(OTHER_TEACHER);

      const res = await call(route, route.staffUrl);

      assert.equal(res.status, 403);
      assert.equal(viewRows().length, 0);
    });
  });
}

describe("GET /api/files/download as an admin", () => {
  it("records the download of any student's file", async () => {
    session = { id: ADMIN, studentId: "a", displayName: "A", role: "admin" };

    const res = await call(ROUTES[0], ROUTES[0].staffUrl);

    assert.equal(res.status, 302);
    assert.deepEqual(viewRows().map((row) => [row.action, row.targetId, row.actorId]), [
      ["teacher.student.view.files", STUDENT.id, ADMIN],
    ]);
  });
});
