/**
 * M6: database queries for one teacher home render.
 *
 * What the numbers are: the Prisma calls the teacher layout, the teacher home
 * page and every server component under them issue for the fixture instructor
 * below, with `@/lib/db` replaced by a counter. The real layout, page, session
 * lookup and loaders run; only client components are stubbed. "Cold" is the
 * first render in a new process. "Warm" is a second render straight after,
 * with the in-process caches the first one filled.
 *
 * What they are not: production truth. No SQL is sent. The calls are counted;
 * round trips are estimated from them by `estimateRoundTrips` (the rules are in
 * src/lib/query-counter.test-support.ts). The three roster reads each select
 * many nested relations, and Prisma's default strategy sends one more SELECT
 * per nested relation below a level that returned rows; that figure is
 * reported as "nested relation loads" and is derived, not observed. Real data can take branches this fixture does not.
 * Requests the browser makes after the page loads are not counted.
 *
 * Read, not executed: 0 queries. `src/proxy.ts` and the root layout
 * (`src/app/layout.tsx:45-47`) run on every request and read only cookies and
 * headers. Nothing on this path had to be counted by reading.
 *
 * The fixture instructor's branches:
 * - signed in as a real teacher (not admin, not a demo account), so the
 *   placement check runs, and finds the instructor placed
 * - no `classId` in the URL: the all-classes view. A chosen class adds the
 *   class access check and the class compliance read
 * - two managed students on the first page, so the batched readiness read
 *   runs (it issues nothing for an empty roster). Its cost does not grow with
 *   the number of students
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { createInitialState } from "@/lib/progression/engine";
import {
  countsByFunction,
  createQueryCounter,
  estimateRoundTrips,
  formatQueryBreakdown,
  queryCountLine,
  summarizeQueries,
  type RecordedQuery,
  type RecordedTransaction,
} from "@/lib/query-counter.test-support";
import { signToken } from "@/lib/session-token";

// Set to the measured value. A change to any of these is a change in what the
// teacher home costs, and belongs in the diff that caused it.
// The 2026-11-10 review estimated about 44. That figure is not Prisma calls:
// the page issues 18. The calls plus their nested relation loads come to 57
// SELECTs, which is the larger unit the estimate was approximating.
const TEACHER_HOME_APP_QUERIES_COLD = 18;
/** Session lookup, its revocation check, and the placement check. */
const TEACHER_HOME_ADMIN_QUERIES_COLD = 3;
/** Nothing on the app client is cached today, so warm equals cold. */
const TEACHER_HOME_APP_QUERIES_WARM = 18;
/** The placement check is not cached. */
const TEACHER_HOME_ADMIN_QUERIES_WARM = 1;
/**
 * [app, admin] nested relation loads, counted only below a level that returned
 * rows: 16 on each of the two roster selects in dashboard.ts, 6 in today.ts, 1
 * on appointments. The fixture rows leave those relations out, so each is
 * counted in full.
 */
const TEACHER_HOME_NESTED_LOADS_COLD: [number, number] = [39, 0];
/**
 * M6: app plus admin round trips, what `node scripts/readiness/query-count.mjs teacher-home` prints.
 * An admin call costs a round trip too, so both clients count.
 */
const TEACHER_HOME_ROUND_TRIPS_COLD = 114;
const TEACHER_HOME_ROUND_TRIPS_WARM = 112;
/** "file › function" -> [app, admin] for the cold render. */
const TEACHER_HOME_COLD_BY_FUNCTION: Record<string, [number, number]> = {
  "src/lib/session-revocation.ts › (anonymous)": [0, 1],
  "src/lib/auth.ts › (anonymous)": [0, 1],
  "src/lib/org-placement.ts › isUnplacedInstructor": [0, 1],
  "src/lib/classroom.ts › listManagedClasses": [1, 0],
  "src/lib/classroom.ts › listManagedStudentIds": [1, 0],
  "src/lib/teacher/dashboard.ts › getInterventionQueue": [2, 0],
  "src/lib/teacher/today.ts › getTodayRoster": [1, 0],
  "src/lib/teacher/dashboard.ts › getTeacherDashboardPage": [5, 0],
  "src/lib/progression/fetch-readiness-data.ts › fetchReadinessDataForStudents": [8, 0],
};

const TEACHER_ID = "tch-readiness-001";
const NOW = new Date("2026-11-10T15:00:00.000Z");
const SESSION_COOKIE = "vq-session";

process.env.JWT_SECRET = "readiness-query-count-jwt-secret-for-tests-only";
const sessionToken = signToken(TEACHER_ID, "teacher", 0);
const progressionState = JSON.stringify(createInitialState());

/** One row that satisfies every `student.findMany` select on this page. */
function studentRow(id: string, displayName: string) {
  return {
    id, studentId: `${id}-login`, displayName, email: null, createdAt: NOW, updatedAt: NOW, isActive: true,
    progression: { state: progressionState },
    goals: [{ level: "bhag", status: "active", updatedAt: NOW, lastReviewedAt: NOW, pathwayId: null }],
    orientationProgress: [{ id: `${id}-op`, completed: true, completedAt: NOW }],
    certifications: [{
      status: "in_progress",
      requirements: [{ templateId: "tpl-1", completed: true, verifiedBy: null, fileId: null }],
    }],
    portfolioItems: [{ updatedAt: NOW }],
    resumeData: { id: `${id}-resume` },
    publicCredentialPage: null,
    files: [{ uploadedAt: NOW }],
    _count: { portfolioItems: 1, files: 1 },
    formSubmissions: [{ id: `${id}-form`, formId: "student-intake", fileId: null, status: "approved", updatedAt: NOW }],
    applications: [{ id: `${id}-application`, updatedAt: NOW }],
    eventRegistrations: [],
    alerts: [{
      id: `${id}-alert`, type: "goal_stale", severity: "medium", title: "Goal needs review", summary: "",
      sourceType: null, sourceId: null, detectedAt: NOW,
    }],
    appointments: [{ id: `${id}-appointment`, startsAt: NOW }],
    conversations: [{ id: `${id}-conversation`, updatedAt: NOW }],
    messages: [{ createdAt: NOW }],
    assignedTasks: [{ id: `${id}-task`, title: "Upload your resume", priority: "normal" }],
    classEnrollments: [{ enrolledAt: NOW, status: "active", class: { programType: "spokes" } }],
  };
}

const students = [studentRow("stu-a", "Avery Fixture"), studentRow("stu-b", "Blake Fixture")];

const counter = createQueryCounter({
  // Session and placement (admin client).
  "admin:sageConfirmationUse.findUnique": null,
  "admin:student.findUnique": {
    id: TEACHER_ID, studentId: "readiness-teacher", displayName: "Tess Fixture",
    role: "teacher", sessionVersion: 0, isActive: true, demoAccount: null,
  },
  "admin:student.findFirst": null,
  // Roster, queue and overview.
  "student.findMany": students,
  "student.count": students.length,
  "spokesClass.findMany": [{
    id: "class-1", name: "Morning cohort", code: "AM1", status: "active", programType: "spokes",
    startDate: NOW, endDate: null,
  }],
  "orientationItem.count": 8,
  "certTemplate.findMany": [{ id: "tpl-1", required: true, needsFile: false, needsVerify: true }],
  "appointment.findMany": [{
    id: "appt-1", title: "Advising check-in", startsAt: NOW, endsAt: NOW, locationType: "in_person",
    locationLabel: "Room 2", student: { id: "stu-a", studentId: "stu-a-login", displayName: "Avery Fixture" },
  }],
  // Batched readiness.
  "progression.findMany": students.map((student) => ({ studentId: student.id, state: progressionState })),
  "orientationProgress.groupBy": students.map((student) => ({ studentId: student.id, _count: 3 })),
  "resumeData.findMany": students.map((student) => ({ studentId: student.id })),
});

mock.module("@/lib/db", { exports: counter.dbModule });
// `src/lib/teacher/dashboard.ts` imports it; outside Next it throws on import.
mock.module("server-only", { exports: {} });
mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) => (name === SESSION_COOKIE ? { name, value: sessionToken } : undefined),
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new Error(`The fixture instructor was redirected to ${to}; the teacher home did not render.`);
    },
  },
});

// Client components are stubbed: they run no server queries.
// CLIENT_COMPONENT_SOURCES is checked below.
const CLIENT_COMPONENT_SOURCES = [
  "src/components/ui/NavBar.tsx",
  "src/components/ui/NotificationProvider.tsx",
  "src/components/teacher/ClassContextSwitcher.tsx",
  "src/components/teacher/ClassOverview.tsx",
  "src/components/teacher/InterventionQueuePanel.tsx",
];
const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
const queuePanelRenders: { initialQueue?: unknown }[] = [];
const overviewRenders: { initialData?: { students?: unknown[] } }[] = [];
mock.module("@/components/ui/NavBar", { exports: { default: () => null } });
mock.module("@/components/ui/NotificationProvider", { exports: { default: passThrough } });
mock.module("@/components/teacher/ClassContextSwitcher", { exports: { default: () => null } });
mock.module("@/components/teacher/ClassOverview", {
  exports: {
    default: (props: { initialData?: { students?: unknown[] } }) => {
      overviewRenders.push(props);
      return null;
    },
  },
});
mock.module("@/components/teacher/InterventionQueuePanel", {
  exports: {
    default: (props: { initialQueue?: unknown }) => {
      queuePanelRenders.push(props);
      return null;
    },
  },
});

interface Render {
  html: string;
  queries: readonly RecordedQuery[];
  transactions: readonly RecordedTransaction[];
  errors: unknown[];
}

let cold: Render;
let warm: Render;

async function renderTeacherHome(
  TeacherLayout: typeof import("@/app/(teacher)/layout").default,
  TeacherDashboard: typeof import("@/app/(teacher)/teacher/page").default,
): Promise<Render> {
  const errors: unknown[] = [];
  const section = await counter.section(async () => {
    const { prelude } = await prerenderToNodeStream(
      <TeacherLayout><TeacherDashboard searchParams={Promise.resolve({})} /></TeacherLayout>,
      { onError: (error) => { errors.push(error); } },
    );
    let html = "";
    for await (const chunk of prelude) html += String(chunk);
    // Let anything the render deferred be issued before the section closes.
    await new Promise((resolve) => setImmediate(resolve));
    return html;
  });
  return { html: section.value, queries: section.queries, transactions: section.transactions, errors };
}

before(async () => {
  const { default: TeacherLayout } = await import("@/app/(teacher)/layout");
  const { default: TeacherDashboard } = await import("@/app/(teacher)/teacher/page");
  cold = await renderTeacherHome(TeacherLayout, TeacherDashboard);
  warm = await renderTeacherHome(TeacherLayout, TeacherDashboard);
});


/** App plus admin round trips: the gate's number. */
function allRoundTrips(queries: readonly RecordedQuery[], transactions: readonly RecordedTransaction[]): number {
  const { app, admin } = estimateRoundTrips(queries, transactions);
  return app.roundTrips + admin.roundTrips;
}

describe("M6: teacher home query count", () => {
  it("renders the whole teacher home for the fixture instructor, with a roster, so no loader stops early", () => {
    assert.deepEqual(cold.errors, []);
    assert.deepEqual(warm.errors, []);
    assert.match(cold.html, /Student Interventions &amp; Daily Overview/);
    assert.match(cold.html, /Avery Fixture/);
    assert.doesNotMatch(cold.html, /Ask your regional coordinator/);
    assert.equal(overviewRenders[0]?.initialData?.students?.length, students.length);
    assert.ok(Array.isArray(queuePanelRenders[0]?.initialQueue), "the intervention queue was not loaded");
  });

  it("stubs only client components", () => {
    for (const source of CLIENT_COMPONENT_SOURCES) {
      assert.match(readFileSync(source, "utf8"), /^\s*["']use client["']/, `${source} is not a client component`);
    }
  });

  it("cold render issues the pinned number of queries on each client", (t) => {
    for (const line of formatQueryBreakdown("M6 teacher home, cold", cold.queries).split("\n")) t.diagnostic(line);
    const summary = summarizeQueries(cold.queries);
    t.diagnostic(queryCountLine({ path: "teacher-home", cache: "cold", queries: cold.queries, transactions: cold.transactions, readNotExecuted: 0 }));

    assert.equal(summary.app, TEACHER_HOME_APP_QUERIES_COLD);
    assert.equal(summary.admin, TEACHER_HOME_ADMIN_QUERIES_COLD);
    assert.deepEqual([summary.appNestedLoads, summary.adminNestedLoads], TEACHER_HOME_NESTED_LOADS_COLD);
    assert.equal(allRoundTrips(cold.queries, cold.transactions), TEACHER_HOME_ROUND_TRIPS_COLD);
  });

  it("cold render's queries come from the pinned functions", () => {
    assert.deepEqual(countsByFunction(cold.queries), TEACHER_HOME_COLD_BY_FUNCTION);
  });

  it("warm render issues the pinned number of queries on each client", (t) => {
    for (const line of formatQueryBreakdown("M6 teacher home, warm", warm.queries).split("\n")) t.diagnostic(line);
    const summary = summarizeQueries(warm.queries);
    t.diagnostic(queryCountLine({ path: "teacher-home", cache: "warm", queries: warm.queries, transactions: warm.transactions, readNotExecuted: 0 }));

    assert.equal(summary.app, TEACHER_HOME_APP_QUERIES_WARM);
    assert.equal(summary.admin, TEACHER_HOME_ADMIN_QUERIES_WARM);
    assert.equal(allRoundTrips(warm.queries, warm.transactions), TEACHER_HOME_ROUND_TRIPS_WARM);
  });
});
