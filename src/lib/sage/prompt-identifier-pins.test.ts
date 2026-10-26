import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

/**
 * FERPA review (2026-09-06) Part 2.3 — fields that must never reach a prompt.
 *
 * The review measured that TANF/SNAP status, race, ethnicity, date of birth,
 * `SpokesRecord.firstName/lastName`, phone numbers and (outside the résumé
 * paths) `Student.email` reach no prompt today, and called that "true and
 * unpinned". This file is the pin. It runs the REAL prompt builders —
 * `assembleStudentContextBundle` + `buildSystemPrompt` for the student chat
 * prompt, `buildStaffStudentContext` for the staff prompt, and the
 * `JSON.stringify(bundle).slice(0, 4000)` the briefing and wager-diagnosis
 * paths send — over a fixture student whose every sensitive field carries a
 * distinctive sentinel, and asserts none of them appears in the rendered text.
 *
 * The Prisma mock returns the FULL fixture row for every single-row read
 * regardless of `select`, so a builder that quietly starts selecting a new
 * column cannot hide behind the projection: the sentinel shows up in the
 * output and the row reds. Red-baselined by injecting `birthDate` into the
 * bundle's `student` block in a scratch copy (see the ticket report).
 *
 * `Student.studentId` (the login username) was the one row that was red on
 * the real code before this ticket: staff-student-context rendered it. It is
 * pinned here alongside the rest.
 */

mock.module("server-only", { namedExports: {} });

// ── Sentinels ───────────────────────────────────────────────────────────────
// Every value is unique enough that a substring match is unambiguous.

const SENTINEL = {
  loginId: "zqx.login.sentinel",
  email: "zqx.email.sentinel@example.org",
  firstName: "Zqxfirstname",
  lastName: "Zqxlastname",
  race: "ZQX-RACE-SENTINEL",
  ethnicity: "ZQX-ETHNICITY-SENTINEL",
  // There is no TANF/SNAP status column in the schema (checked 2026-09-07);
  // these are the benefit-status-adjacent SpokesRecord fields that exist.
  householdType: "ZQX-HOUSEHOLD-SENTINEL",
  county: "ZQX-COUNTY-SENTINEL",
  gender: "ZQX-GENDER-SENTINEL",
  barrier: "ZQX-BARRIER-SENTINEL",
  referralEmail: "zqx.referral.sentinel@example.org",
  phone: "+13045550142",
} as const;

const BIRTH_DATE = new Date("1987-03-14T00:00:00.000Z");
/** Every rendering of the DOB a builder could plausibly produce. */
const BIRTH_RENDERINGS = ["1987-03-14", "03/14/1987", "3/14/1987", "Mar 14, 1987", "March 14, 1987", "1987"];

const STUDENT_ID = "clzstudent00000sentinel0";
const CREATED_AT = new Date("2026-03-14T12:00:00.000Z");

function studentRow() {
  return {
    id: STUDENT_ID,
    studentId: SENTINEL.loginId,
    displayName: "Tanesha Rivers",
    email: SENTINEL.email,
    role: "student",
    isActive: true,
    createdAt: CREATED_AT,
    classroomConfirmedAt: null,
    spokesRecord: {
      id: "clzspokes0000000sentinel",
      studentId: STUDENT_ID,
      firstName: SENTINEL.firstName,
      lastName: SENTINEL.lastName,
      referralEmail: SENTINEL.referralEmail,
      county: SENTINEL.county,
      householdType: SENTINEL.householdType,
      gender: SENTINEL.gender,
      birthDate: BIRTH_DATE,
      race: SENTINEL.race,
      ethnicity: SENTINEL.ethnicity,
      barriersOnEntry: [SENTINEL.barrier],
      barriersRemaining: [SENTINEL.barrier],
      status: "enrolled",
    },
    notificationPreferences: [
      { channel: "sms", enabled: true, destination: SENTINEL.phone, smsConsentAt: CREATED_AT },
    ],
    classEnrollments: [
      {
        status: "active",
        enrolledAt: CREATED_AT,
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
  };
}

// ── Prisma mock: full rows regardless of `select` ───────────────────────────

const SINGLE_ROW_FIXTURES: Record<string, () => unknown> = {
  student: studentRow,
};

function modelProxy(model: string) {
  return new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method !== "string") return undefined;
        return async () => {
          if (method === "findMany") return [];
          if (method === "count") return 0;
          if (method === "findUnique" || method === "findFirst" || method === "findUniqueOrThrow") {
            return SINGLE_ROW_FIXTURES[model]?.() ?? null;
          }
          return {};
        };
      },
    },
  );
}

const prismaMock = new Proxy(
  {},
  {
    get(_target, model) {
      if (typeof model !== "string" || model.startsWith("$")) return undefined;
      return modelProxy(model);
    },
  },
);

mock.module("@/lib/db", { namedExports: { prisma: prismaMock, prismaAdmin: prismaMock } });

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

mock.module("@/lib/sage/wager-metrics", {
  namedExports: {
    computeWagerHitRate: () => ({ hitRate: 0, won: 0, lost: 0 }),
    getWagerHitRate: async () => ({ hitRate: 0, won: 0, lost: 0 }),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: async (_session: unknown, id: string) => ({ id }),
    buildManagedStudentWhere: () => ({}),
  },
});

// ── Modules under test (imported after the mocks) ───────────────────────────

let assembleStudentContextBundle: typeof import("./context-bundle").assembleStudentContextBundle;
let selfMetricLineFromBundle: typeof import("./context-bundle").selfMetricLineFromBundle;
let buildSystemPrompt: typeof import("./system-prompts").buildSystemPrompt;
let buildStaffStudentContext: typeof import("./staff-student-context").buildStaffStudentContext;

before(async () => {
  ({ assembleStudentContextBundle, selfMetricLineFromBundle } = await import("./context-bundle"));
  ({ buildSystemPrompt } = await import("./system-prompts"));
  ({ buildStaffStudentContext } = await import("./staff-student-context"));
});

// ── Assertion ───────────────────────────────────────────────────────────────

function assertNoIdentifiers(text: string, surface: string) {
  for (const [name, value] of Object.entries(SENTINEL)) {
    assert.ok(!text.includes(value), `${surface}: ${name} (${value}) reached the prompt`);
  }
  for (const rendering of BIRTH_RENDERINGS) {
    assert.ok(!text.includes(rendering), `${surface}: birthDate rendered as "${rendering}" reached the prompt`);
  }
}

/** Mirrors the student branch of POST /api/chat/send. */
async function renderStudentChatPrompt(stage: "discovery" | "onboarding") {
  const bundle = await assembleStudentContextBundle(STUDENT_ID, {
    viewer: "sage",
    conversationId: "clzconv0000000000sentinel",
    conversationStage: stage,
    includeChatPromptContext: true,
    priorSummaryLimit: 3,
  });
  const promptContext = bundle.chatPromptContext;
  assert.ok(promptContext, "expected chatPromptContext");
  const student = studentRow();
  const prompt =
    promptContext.priorConversationContext +
    buildSystemPrompt(stage, {
      studentName: student.displayName,
      programType: "spokes",
      classroomConfirmedAt: null,
      bhag: promptContext.goalsByLevel["bhag"],
      monthly: promptContext.goalsByLevel["monthly"],
      weekly: promptContext.goalsByLevel["weekly"],
      daily: promptContext.goalsByLevel["daily"],
      goals_summary: promptContext.goalsSummary,
      student_status_summary: promptContext.studentStatusSummary,
      userMessage: "What should I work on today?",
      discovery_summary: promptContext.discoverySummary,
      career_profile_context: promptContext.careerProfileContext,
      skillGapContext: promptContext.skillGapContext,
      pathwayContext: promptContext.pathwayContext,
      coachingArcContext: promptContext.coachingArcContext,
      selfMetricsLine: selfMetricLineFromBundle(bundle),
    }, "full");
  return { bundle, prompt };
}

describe("prompt identifier pins: the student chat system prompt", () => {
  it("discovery stage carries the display name and none of the sensitive fields", async () => {
    const { prompt } = await renderStudentChatPrompt("discovery");
    assert.ok(prompt.includes("Tanesha Rivers"), "sanity: the prompt was built with the fixture student");
    assertNoIdentifiers(prompt, "student chat (discovery)");
  });

  it("onboarding stage carries none of the sensitive fields", async () => {
    const { prompt } = await renderStudentChatPrompt("onboarding");
    assert.ok(prompt.includes("Tanesha Rivers"));
    assertNoIdentifiers(prompt, "student chat (onboarding)");
  });
});

describe("prompt identifier pins: the briefing / wager-diagnosis bundle slice", () => {
  it("JSON.stringify(bundle) carries none of the sensitive fields — in the first 4,000 chars or anywhere", async () => {
    const bundle = await assembleStudentContextBundle(STUDENT_ID, { viewer: "sage" });
    const serialized = JSON.stringify(bundle);
    // The briefing (briefing.ts) and wager-diagnosis (wager-diagnosis.ts)
    // send exactly this slice. The review noted DOB is FETCHED into the
    // bundle assembler for an alert flag; this pins that it never lands in
    // the serialised object, not merely that key order keeps it past 4,000.
    assertNoIdentifiers(serialized.slice(0, 4000), "bundle slice (first 4000)");
    assertNoIdentifiers(serialized, "bundle (whole)");
    assert.ok(serialized.includes("Tanesha Rivers"), "sanity: the bundle was assembled from the fixture");
  });
});

describe("prompt identifier pins: the staff student-record context", () => {
  const teacherSession = { id: "t1", studentId: "teacher.login", displayName: "Ms. Legg", role: "teacher" };

  it("the verified record carries the display name and none of the sensitive fields", async () => {
    const result = await buildStaffStudentContext(teacherSession, {
      userMessage: "/student Tanesha Rivers",
      targetStudentId: STUDENT_ID,
    });
    assert.equal(result.resolution, "resolved");
    assert.ok(result.context?.includes("Tanesha Rivers"));
    assertNoIdentifiers(result.context ?? "", "staff student context");
  });

  it("the teacher_assistant system prompt built around it carries none either", async () => {
    const result = await buildStaffStudentContext(teacherSession, {
      userMessage: "/student Tanesha Rivers",
      targetStudentId: STUDENT_ID,
    });
    const prompt = buildSystemPrompt("teacher_assistant", {
      studentName: teacherSession.displayName,
      userMessage: "Give me a progress report for Tanesha Rivers.",
      staffStudentContext: result.context,
    }, "full");
    assert.ok(prompt.includes("Tanesha Rivers"));
    assertNoIdentifiers(prompt, "teacher_assistant prompt");
  });
});
