/* eslint-disable @typescript-eslint/no-explicit-any -- the fake Prisma client stands in for many model signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Each staff GET that returns one student's record writes one view row with
 * its surface, and a refused GET writes none.
 *
 * Only `@/lib/db` and the I/O helpers a route calls (storage, archive
 * generation, quota, SPOKES hydration, AI) are faked. The session wrapper,
 * `assertStaffCanManageStudent` and `recordStudentView` are the production
 * code: a fake of the permission check would restate the answer the route is
 * meant to ask for (Known Issues, "a route test that mocks the module under
 * test"). The fake `student.findFirst` applies the teacher scope it is handed,
 * as Postgres would.
 */

const OWNER_TEACHER = "cteacherowner00000000001";
const OTHER_TEACHER = "cteacherother00000000001";
const STUDENT = { id: "cstudent0000000000000001", studentId: "learner1", displayName: "Ada", role: "student", isActive: true };
const ROW_ID = "cfailedextract0000000001";
const RESPONSE_ID = "cformresponse00000000001";
const GOAL_ID = "cgoal0000000000000000001";

type TestSession = { id: string; studentId: string; displayName: string; role: string; demoAccount?: "instructor" };
let session: TestSession | null = null;

const auditCreates: Array<{ action: string; targetId: string | null; actorId: string | null }> = [];

/** What the database returns for a staff lookup of the student, applying the where clause. */
function managedStudentLookup(args: any) {
  const where = JSON.stringify(args?.where ?? {});
  const named = where.includes(`"${STUDENT.id}"`) || where.includes(`"${STUDENT.studentId}"`);
  if (!named) return null;
  const scopedToOwner = where.includes(`"instructorId":"${OWNER_TEACHER}"`);
  const unscoped = !where.includes('"classEnrollments"');
  return scopedToOwner || unscoped ? STUDENT : null;
}

const now = new Date("2026-11-10T12:00:00.000Z");
let failedExtractionRow: Record<string, unknown> | null;
let goalRow: Record<string, unknown> | null;

const fakePrisma = {
  student: {
    findFirst: async (args: any) => managedStudentLookup(args),
    findUnique: async () => ({ id: STUDENT.id, studentId: STUDENT.studentId, displayName: STUDENT.displayName, email: null }),
  },
  sageMemory: { findMany: async () => [{ id: "m1", content: "Likes welding" }] },
  moodEntry: { findMany: async () => [{ id: "mood1", score: 7 }] },
  caseNote: { findMany: async () => [{ id: "n1", body: "Met today" }] },
  formSubmission: { findMany: async () => [] },
  fileUpload: { findMany: async () => [] },
  formResponse: {
    findMany: async () => [],
    findUnique: async () => ({
      id: RESPONSE_ID,
      templateId: "t1",
      studentId: STUDENT.id,
      answers: "{}",
      status: "submitted",
      submittedAt: now,
      reviewedAt: null,
      reviewerNotes: null,
      createdAt: now,
      updatedAt: now,
      student: { id: STUDENT.id, studentId: STUDENT.studentId, displayName: STUDENT.displayName },
      template: { id: "t1", title: "Intake", schema: "{}" },
    }),
  },
  spokesChecklistTemplate: { findMany: async () => [] },
  spokesModuleTemplate: { findMany: async () => [] },
  spokesRecord: {
    findUnique: async () => ({ id: "rec1", checklistProgress: [], moduleProgress: [], employmentFollowUps: [] }),
  },
  application: { findMany: async () => [] },
  studentClassEnrollment: { findMany: async () => [] },
  goal: { findFirst: async () => goalRow },
  pathway: { findMany: async () => [] },
  failedExtraction: { findUnique: async () => failedExtractionRow },
  $queryRaw: async () => [],
};

const fakePrismaAdmin = {
  auditLog: {
    // Same-day sampling: a row already written for this actor, action and student.
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
      getPresignedDownloadUrl: async () => "https://storage.example/archive.zip",
      downloadFile: async () => null,
    },
  });
  mock.module("@/lib/student-archive", { namedExports: { generateStudentArchive: async () => ({ storageKey: "k", fileCount: 0 }) } });
  mock.module("@/lib/llm-usage", {
    namedExports: { checkTokenQuota: async () => ({ allowed: true, tokensUsedToday: 0, dailyLimit: 1000, remaining: 1000 }) },
  });
  mock.module("@/lib/spokes", {
    namedExports: { ensureSpokesRecordForStudent: async () => ({ id: "rec1" }), buildSpokesSummary: () => ({}) },
  });
  mock.module("@/lib/placement-bridge", {
    namedExports: {
      getPlacementBridgeScope: async () => null,
      buildPlacementSuggestion: () => null,
      evaluatePlacementProvenance: () => ({ ok: true }),
    },
  });
  mock.module("@/lib/ai", { namedExports: { resolveAiProvider: async () => ({ name: "fake" }) } });

  const load = async (path: string): Promise<GetHandler> => (await import(path)).GET as GetHandler;
  handlers.archive = await load("./students/[id]/archive/route");
  handlers.memories = await load("./students/[id]/memories/route");
  handlers.mood = await load("./students/[id]/mood/route");
  handlers.notes = await load("./students/[id]/notes/route");
  handlers.forms = await load("./students/[id]/forms/route");
  handlers.structuredForms = await load("./students/[id]/structured-forms/route");
  handlers.usage = await load("./students/[id]/usage/route");
  handlers.spokes = await load("./students/[id]/spokes/route");
  handlers.pathway = await load("./students/[id]/goals/[goalId]/pathway-suggestions/route");
  handlers.formResponse = await load("./forms/responses/[id]/route");
  handlers.failedExtraction = await load("./failed-extractions/[id]/route");
});

function teacher(id: string): TestSession {
  return { id, studentId: "t", displayName: "T", role: "teacher" };
}

beforeEach(() => {
  auditCreates.length = 0;
  session = teacher(OWNER_TEACHER);
  failedExtractionRow = {
    id: ROW_ID,
    studentId: STUDENT.id,
    conversationId: "conv1",
    extractorKey: "goal_extraction",
    error: "SyntaxError",
    attempts: 3,
    status: "open",
    createdAt: now,
    payload: '{"messages":[{"role":"user","content":"I want my GED"}]}',
  };
  goalRow = { id: GOAL_ID, content: "Get a welding job", pathwayId: null };
});

function viewRows() {
  return auditCreates.filter((row) => row.action.startsWith("teacher.student.view."));
}

interface RouteCase {
  name: string;
  handler: string;
  surface: string;
  url: string;
  params: Record<string, string>;
  okStatus?: number;
}

const ROUTES: RouteCase[] = [
  { name: "students/[id]/archive", handler: "archive", surface: "archive", url: `/x?key=archives/${STUDENT.id}/a.zip`, params: { id: STUDENT.id }, okStatus: 302 },
  { name: "students/[id]/memories", handler: "memories", surface: "memories", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/mood", handler: "mood", surface: "mood", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/notes", handler: "notes", surface: "notes", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/forms", handler: "forms", surface: "forms", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/structured-forms", handler: "structuredForms", surface: "forms", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/usage", handler: "usage", surface: "usage", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/spokes", handler: "spokes", surface: "spokes", url: "/x", params: { id: STUDENT.id } },
  { name: "students/[id]/goals/[goalId]/pathway-suggestions", handler: "pathway", surface: "pathway", url: "/x", params: { id: STUDENT.id, goalId: GOAL_ID } },
  { name: "forms/responses/[id]", handler: "formResponse", surface: "forms", url: "/x", params: { id: RESPONSE_ID } },
  { name: "failed-extractions/[id]", handler: "failedExtraction", surface: "failed_extraction", url: "/x", params: { id: ROW_ID } },
];

function call(route: RouteCase, overrides: Partial<RouteCase> = {}): Promise<Response> {
  const merged = { ...route, ...overrides };
  return handlers[merged.handler](new Request(`http://localhost${merged.url}`), { params: Promise.resolve(merged.params) });
}

for (const route of ROUTES) {
  describe(`GET /api/teacher/${route.name}`, () => {
    it(`records one "${route.surface}" view for the student the data belongs to`, async () => {
      const res = await call(route);

      assert.equal(res.status, route.okStatus ?? 200);
      const rows = viewRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].action, `teacher.student.view.${route.surface}`);
      assert.equal(rows[0].targetId, STUDENT.id);
      assert.equal(rows[0].actorId, OWNER_TEACHER);
    });

    it("records no view when a student calls it", async () => {
      session = { id: STUDENT.id, studentId: STUDENT.studentId, displayName: "Ada", role: "student" };

      const res = await call(route);

      assert.equal(res.status, 403);
      assert.equal(viewRows().length, 0);
    });

    it("records no view for a teacher of another class", async () => {
      session = teacher(OTHER_TEACHER);

      const res = await call(route);

      assert.equal(res.status, 403);
      assert.equal(viewRows().length, 0);
    });
  });
}

describe("a GET that returns no record writes no view", () => {
  const byHandler = (handler: string) => ROUTES.find((route) => route.handler === handler) as RouteCase;

  it("archive: a key for another student's folder is refused", async () => {
    const res = await call(byHandler("archive"), { url: "/x?key=archives/someone-else/a.zip" });
    assert.equal(res.status, 400);
    assert.equal(viewRows().length, 0);
  });

  it("pathway suggestions: a goal that is not the student's", async () => {
    goalRow = null;
    const res = await call(byHandler("pathway"));
    assert.equal(res.status, 404);
    assert.equal(viewRows().length, 0);
  });

  it("failed extraction: an id that is not a cuid", async () => {
    const res = await call(byHandler("failedExtraction"), { params: { id: "not-a-cuid" } });
    assert.equal(res.status, 400);
    assert.equal(viewRows().length, 0);
  });

  it("failed extraction: a row that does not exist", async () => {
    failedExtractionRow = null;
    const res = await call(byHandler("failedExtraction"));
    assert.equal(res.status, 404);
    assert.equal(viewRows().length, 0);
  });
});

describe("the shared demo instructor cannot read a failed extraction", () => {
  it("is refused before the row is read, and no view is written", async () => {
    // The demo policy denies the list (src/lib/demo/instructor-policy.ts);
    // the conversation text now lives on the detail route, so it refuses too.
    session = { ...teacher(OWNER_TEACHER), demoAccount: "instructor" };
    const res = await call(ROUTES[ROUTES.length - 1]);
    assert.equal(res.status, 403);
    assert.equal(viewRows().length, 0);
  });
});

describe("archive downloads are each recorded", () => {
  it("writes a second row for a second download the same day", async () => {
    const archive = ROUTES[0];
    await call(archive);
    await call(archive);
    assert.equal(viewRows().length, 2);
  });
});

describe("GET /api/teacher/failed-extractions/[id] returns the one row", () => {
  it("returns the stored conversation snapshot and the error for a managed student", async () => {
    const res = await call(ROUTES[ROUTES.length - 1]);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.data.id, ROW_ID);
    assert.equal(body.data.error, "SyntaxError");
    assert.match(body.data.payload, /I want my GED/u);
  });
});
