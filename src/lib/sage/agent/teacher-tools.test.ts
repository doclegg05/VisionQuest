/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import type { AgentToolContext } from "./types";

// "server-only" throws at import time outside a Next.js server build;
// @/lib/teacher/dashboard imports it. Stub before the tool's lazy import runs.
mock.module("server-only", { namedExports: {} });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Full-shape Student row matching getInterventionQueue's select. The
 * high-severity alert + overdue tasks guarantee urgencyScore > 0, so the
 * student survives the queue's `urgencyScore > 0` filter.
 */
function queueStudentRow(overrides: { id: string; displayName: string }) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
  return {
    id: overrides.id,
    studentId: `pub-${overrides.id}`,
    displayName: overrides.displayName,
    email: null,
    createdAt: thirtyDaysAgo,
    updatedAt: thirtyDaysAgo,
    progression: null,
    goals: [],
    orientationProgress: [],
    alerts: [
      {
        id: `alert-${overrides.id}`,
        type: "overdue_task",
        severity: "high",
        title: "Overdue tasks",
        summary: "Has overdue tasks piling up",
        sourceType: null,
        sourceId: null,
        detectedAt: thirtyDaysAgo,
      },
    ],
    assignedTasks: [{ id: "task-1" }, { id: "task-2" }],
    conversations: [],
    portfolioItems: [],
    files: [],
    formSubmissions: [],
    applications: [],
    eventRegistrations: [],
    certifications: [],
    resumeData: null,
    publicCredentialPage: null,
    classEnrollments: [
      { enrolledAt: thirtyDaysAgo, status: "active", class: { programType: "spokes" } },
    ],
  };
}

const state = {
  appStudentRows: [] as unknown[],
  appStudentCalls: 0,
  adminStudentRows: [] as unknown[],
  adminStudentCalls: 0,
  adminStudentWhere: null as Record<string, any> | null,
  regionAssignments: [] as Array<{ regionId: string }>,
  regionCoordinatorCalls: 0,
  regionCoordinatorWhere: null as Record<string, any> | null,
};

// Top-level mock.module (wagers-db.test.ts pattern) — module scope, so the
// mock applies before the tool's lazy `import("@/lib/teacher/dashboard")`.
mock.module("@/lib/db", {
  namedExports: {
    // The RLS-scoped app client. Coordinator sessions collapse to
    // role="student"/studentId=coordinatorId under RLS, so Student queries
    // return zero rows for them — appStudentRows models what RLS lets through.
    prisma: {
      student: {
        findMany: async () => {
          state.appStudentCalls += 1;
          return state.appStudentRows;
        },
      },
      orientationItem: { count: async () => 5 },
    },
    prismaAdmin: {
      regionCoordinator: {
        findMany: async (args: { where?: Record<string, any> }) => {
          state.regionCoordinatorCalls += 1;
          state.regionCoordinatorWhere = args?.where ?? null;
          return state.regionAssignments;
        },
      },
      student: {
        findMany: async (args: { where?: Record<string, any> }) => {
          state.adminStudentCalls += 1;
          state.adminStudentWhere = args?.where ?? null;
          return state.adminStudentRows;
        },
      },
      orientationItem: { count: async () => 5 },
    },
  },
});

// Safe as a static import: teacher-tools.ts only imports types at module
// scope and loads @/lib/teacher/dashboard lazily inside execute().
import { TEACHER_TOOLS } from "./teacher-tools";

const attentionTool = TEACHER_TOOLS.find(
  (tool) => tool.name === "list_students_needing_attention",
);
assert.ok(attentionTool, "list_students_needing_attention must be registered");

const coordinatorSession: Session = {
  id: "coord-1",
  studentId: "",
  displayName: "Cora Coordinator",
  role: "coordinator",
};

const teacherSession: Session = {
  id: "teach-1",
  studentId: "",
  displayName: "Tess Teacher",
  role: "teacher",
};

function ctxFor(session: Session): AgentToolContext {
  return { session, conversationId: "conv-1" };
}

beforeEach(() => {
  state.appStudentRows = [];
  state.appStudentCalls = 0;
  state.adminStudentRows = [];
  state.adminStudentCalls = 0;
  state.adminStudentWhere = null;
  state.regionAssignments = [];
  state.regionCoordinatorCalls = 0;
  state.regionCoordinatorWhere = null;
});

describe("list_students_needing_attention — coordinator sessions", () => {
  it("returns region-scoped students via the admin client (app client is RLS fail-closed)", async () => {
    state.regionAssignments = [{ regionId: "region-1" }, { regionId: "region-2" }];
    state.adminStudentRows = [queueStudentRow({ id: "stu-1", displayName: "Alice Region" })];

    const result = await attentionTool.execute({}, ctxFor(coordinatorSession));

    assert.equal(result.status, "success");
    const students = (result.data as { students: Array<{ name: string }> }).students;
    assert.equal(students.length, 1);
    assert.equal(students[0].name, "Alice Region");

    // A coordinator's RLS context can never see these rows through the app
    // client — the read must go through prismaAdmin, explicitly scoped.
    assert.equal(state.appStudentCalls, 0);
    assert.equal(state.adminStudentCalls, 1);
    assert.deepEqual(state.regionCoordinatorWhere, {
      coordinatorId: "coord-1",
      region: { status: "active" },
    });

    // Explicit scoping: only active students enrolled (non-archived
    // enrollment) in non-archived classes inside the coordinator's regions.
    assert.equal(state.adminStudentWhere?.role, "student");
    assert.equal(state.adminStudentWhere?.isActive, true);
    const enrollmentScope = state.adminStudentWhere?.classEnrollments?.some;
    assert.deepEqual(enrollmentScope?.class?.regionId, { in: ["region-1", "region-2"] });
    assert.deepEqual(enrollmentScope?.class?.status, { not: "archived" });
  });

  it("fails closed to an empty queue when the coordinator has no active regions", async () => {
    state.regionAssignments = [];
    state.adminStudentRows = [queueStudentRow({ id: "stu-1", displayName: "Alice Region" })];

    const result = await attentionTool.execute({}, ctxFor(coordinatorSession));

    assert.equal(result.status, "success");
    assert.deepEqual((result.data as { students: unknown[] }).students, []);
    // No regions → never touches the student table at all.
    assert.equal(state.adminStudentCalls, 0);
  });
});

describe("getCoordinatorInterventionQueue — role guard", () => {
  it("refuses non-coordinator sessions before touching any data", async () => {
    const { getCoordinatorInterventionQueue } = await import("@/lib/teacher/dashboard");

    await assert.rejects(
      () => getCoordinatorInterventionQueue(teacherSession),
      /Coordinator session required/,
    );
    assert.equal(state.regionCoordinatorCalls, 0);
  });
});

describe("list_students_needing_attention — staff sessions", () => {
  it("keeps teachers on the RLS-scoped app client", async () => {
    state.appStudentRows = [queueStudentRow({ id: "stu-2", displayName: "Marcus Managed" })];

    const result = await attentionTool.execute({}, ctxFor(teacherSession));

    assert.equal(result.status, "success");
    const students = (result.data as { students: Array<{ name: string }> }).students;
    assert.equal(students[0]?.name, "Marcus Managed");
    assert.equal(state.appStudentCalls, 1);
    assert.equal(state.adminStudentCalls, 0);
    assert.equal(state.regionCoordinatorCalls, 0);
  });
});
