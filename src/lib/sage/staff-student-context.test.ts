import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// "server-only" throws at import time outside a Next.js server build.
// The functions exercised here are pure, so we stub the module before
// the dynamic import below resolves staff-student-context.ts.
mock.module("server-only", { namedExports: {} });

// ── Prisma + classroom + readiness mocks for the context-building tests ──────
// The mocks return FULL rows regardless of `select`, so a builder that ever
// starts reading a field it did not use to read cannot hide behind the
// projection — the sentinel shows up in the rendered text and the test reds.

/** The login username. FERPA review W7: it is an identifier and must not reach a prompt. */
const LOGIN_ID = "zqx.login.sentinel";
const LOGIN_ID_ONE = "zqx.login.one";
const LOGIN_ID_TWO = "zqx.login.two";

function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "stu1",
    studentId: LOGIN_ID,
    displayName: "Karissa Johnson",
    email: "karissa.zqx@example.org",
    isActive: true,
    createdAt: new Date("2026-03-14T12:00:00.000Z"),
    classEnrollments: [
      {
        status: "active",
        enrolledAt: new Date("2026-03-15T12:00:00.000Z"),
        class: { name: "Morning Cohort", code: "MC-01", programType: "spokes" },
      },
    ],
    progression: null,
    goals: [],
    formSubmissions: [],
    certifications: [],
    portfolioItems: [],
    resumeData: null,
    publicCredentialPage: null,
    assignedTasks: [],
    caseNotes: [],
    alerts: [],
    appointments: [],
    applications: [],
    careerDiscovery: null,
    ...overrides,
  };
}

const state = {
  student: studentRow() as Record<string, unknown> | null,
  candidates: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findUnique: async () => state.student,
        findMany: async () => state.candidates,
      },
      orientationItem: { findMany: async () => [] },
      orientationProgress: { findMany: async () => [] },
    },
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: async (_session: unknown, id: string) => ({ id }),
    buildManagedStudentWhere: () => ({}),
  },
});

mock.module("@/lib/progression/fetch-readiness-data", {
  namedExports: {
    fetchStudentReadinessData: async () => ({
      readiness: {
        score: 40,
        breakdown: { orientation: { label: "Orientation", score: 4, max: 10 } },
      },
      orientationProgress: { completed: 1, total: 5 },
    }),
  },
});

type StaffStudentCandidate = import("./staff-student-context").StaffStudentCandidate;
let resolveStudentMention: typeof import("./staff-student-context").resolveStudentMention;
let shouldAttemptStaffStudentContext: typeof import("./staff-student-context").shouldAttemptStaffStudentContext;
let buildStaffStudentContext: typeof import("./staff-student-context").buildStaffStudentContext;

before(async () => {
  const mod = await import("./staff-student-context");
  resolveStudentMention = mod.resolveStudentMention;
  shouldAttemptStaffStudentContext = mod.shouldAttemptStaffStudentContext;
  buildStaffStudentContext = mod.buildStaffStudentContext;
});

const teacherSession = { id: "t1", studentId: "teacher.login", displayName: "Ms. Legg", role: "teacher" };

const candidates: StaffStudentCandidate[] = [
  { id: "stu1", displayName: "Karissa Johnson", studentId: "karissa.j" },
  { id: "stu2", displayName: "Marcus Lee", studentId: "mlee" },
  { id: "stu3", displayName: "Karissa Smith", studentId: "ksmith" },
];

describe("resolveStudentMention", () => {
  it("resolves a managed student by full display name", () => {
    const result = resolveStudentMention(
      candidates,
      "Can you give me a progress report for Karissa Johnson?",
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.student?.id, "stu1");
  });

  it("resolves a managed student by student username", () => {
    const result = resolveStudentMention(
      candidates,
      "What should I do next for mlee?",
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.student?.id, "stu2");
  });

  it("uses recent prior instructor messages for pronoun follow-up", () => {
    const result = resolveStudentMention(
      candidates,
      "She is in my class. Do you have access to her record?",
      ["Tell me about Marcus Lee."],
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.student?.id, "stu2");
  });

  it("marks first-name-only matches ambiguous when multiple managed students match", () => {
    const result = resolveStudentMention(
      candidates,
      "Can you check Karissa's progress?",
    );

    assert.equal(result.status, "ambiguous");
    assert.equal(result.matches?.length, 2);
  });
});

describe("shouldAttemptStaffStudentContext", () => {
  it("skips general teacher planning messages", () => {
    assert.equal(
      shouldAttemptStaffStudentContext("Help me plan tomorrow's lesson about goal setting."),
      false,
    );
  });

  it("skips program lookup questions without a student reference", () => {
    assert.equal(
      shouldAttemptStaffStudentContext("Which orientation forms are required this week?"),
      false,
    );
  });

  it("loads context for explicit student slash commands", () => {
    assert.equal(shouldAttemptStaffStudentContext("/student Marcus Lee"), true);
  });

  it("loads context for student-specific progress requests", () => {
    assert.equal(
      shouldAttemptStaffStudentContext("Can you give me a progress report for Marcus Lee?"),
      true,
    );
  });

  it("loads context for pronoun follow-ups after a student-specific turn", () => {
    assert.equal(
      shouldAttemptStaffStudentContext(
        "What should I do next for her?",
        ["Can you give me a progress report for Karissa Johnson?"],
      ),
      true,
    );
  });
});

// ── FERPA review W7 (2026-09-06): the login username leaves every prompt ────

describe("buildStaffStudentContext: no login id in the verified record", () => {
  it("renders the student's name but never Student.studentId", async () => {
    state.student = studentRow();
    const result = await buildStaffStudentContext(teacherSession, {
      userMessage: "/student Karissa Johnson",
      targetStudentId: "stu1",
    });

    assert.equal(result.resolution, "resolved");
    assert.ok(result.context, "expected a rendered context");
    assert.ok(result.context.includes("Karissa Johnson"));
    assert.ok(
      !result.context.includes(LOGIN_ID),
      `the login username reached the staff prompt:\n${result.context}`,
    );
  });

  it("does not render the student's email either", async () => {
    state.student = studentRow();
    const result = await buildStaffStudentContext(teacherSession, {
      userMessage: "/student Karissa Johnson",
      targetStudentId: "stu1",
    });
    assert.ok(!result.context?.includes("karissa.zqx@example.org"));
  });
});

describe("buildStaffStudentContext: no login id in the ambiguous-name branch", () => {
  it("disambiguates two matches by enrollment month, not by login username", async () => {
    state.candidates = [
      { id: "s1", displayName: "Karissa Johnson", studentId: LOGIN_ID_ONE, createdAt: new Date("2026-03-14T12:00:00.000Z") },
      { id: "s2", displayName: "Karissa Smith", studentId: LOGIN_ID_TWO, createdAt: new Date("2026-08-02T12:00:00.000Z") },
    ];
    const result = await buildStaffStudentContext(teacherSession, {
      userMessage: "Can you check Karissa's progress?",
    });

    assert.equal(result.resolution, "ambiguous");
    assert.ok(result.context);
    assert.ok(result.context.includes("Karissa Johnson"));
    assert.ok(result.context.includes("Karissa Smith"));
    assert.ok(!result.context.includes(LOGIN_ID_ONE), `login id leaked: ${result.context}`);
    assert.ok(!result.context.includes(LOGIN_ID_TWO), `login id leaked: ${result.context}`);
    // The teacher still gets SOMETHING to tell the two apart.
    assert.ok(result.context.includes("enrolled Mar 2026"), result.context);
    assert.ok(result.context.includes("enrolled Aug 2026"), result.context);
  });

  it("still resolves a student the instructor names by login username", async () => {
    // Matching on the username as INPUT is unchanged — the teacher may type
    // it; it just never comes back out in the prompt.
    state.candidates = [
      { id: "stu1", displayName: "Karissa Johnson", studentId: LOGIN_ID, createdAt: new Date("2026-03-14T12:00:00.000Z") },
      { id: "s2", displayName: "Marcus Lee", studentId: "mlee", createdAt: new Date("2026-03-14T12:00:00.000Z") },
    ];
    state.student = studentRow();
    const result = await buildStaffStudentContext(teacherSession, {
      userMessage: `What should I do next for ${LOGIN_ID}?`,
    });
    assert.equal(result.resolution, "resolved");
    assert.equal(result.targetStudentId, "stu1");
    assert.ok(!result.context?.includes(LOGIN_ID));
  });
});
