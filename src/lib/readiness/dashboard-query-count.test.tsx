/**
 * M1: database queries for one student dashboard render.
 *
 * What the numbers are: the Prisma calls the student layout, the dashboard
 * page and every server component under them issue for the fixture student
 * below, with `@/lib/db` replaced by a counter. The real layout, page, session
 * lookup and readers run; only client components are stubbed. "Cold" is the
 * first render in a new process. "Warm" is a second render straight after,
 * with the in-process caches the first one filled.
 *
 * What they are not: production truth. No SQL is sent. The calls are counted;
 * round trips are estimated from them by `estimateRoundTrips` (the rules are in
 * src/lib/query-counter.test-support.ts). Real data can take branches
 * this fixture does not. Requests the browser makes after the page loads
 * (notifications, progression check-in) are a different metric, M2.
 *
 * Read, not executed: 0 queries. `src/proxy.ts` and the root layout
 * (`src/app/layout.tsx:45-47`) run on every request and read only cookies and
 * headers. Nothing on this path had to be counted by reading.
 *
 * The fixture student's branches:
 * - signed in as a real student (not a demo account), session not revoked
 * - recovery questions set, so no redirect to /recovery-setup
 * - goals exist and orientation is started but incomplete (3 of 8), so the
 *   page skips its welcome-routing reads (2 more queries on that branch)
 * - no SMS preference row, intake form on file, no saved Sage panel
 * - no mood entry today, so the mood check-in card renders
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
import { SECURITY_QUESTIONS } from "@/lib/security-questions";
import { signToken } from "@/lib/session-token";

// Set to the measured value. A change to any of these is a change in what the
// dashboard costs, and belongs in the diff that caused it.
// The 2026-11-10 review estimated about 39 app queries by reading. It missed
// the mood check-in gate (1) and counted the reader block as 24, not 25.
const DASHBOARD_APP_QUERIES_COLD = 40;
/** The session lookup and its revocation check; both cached for seconds. */
const DASHBOARD_ADMIN_QUERIES_COLD = 2;
/** Nothing on the app client is cached today, so warm equals cold. */
const DASHBOARD_APP_QUERIES_WARM = 40;
const DASHBOARD_ADMIN_QUERIES_WARM = 0;
/** [app, admin] nested relation loads, counted only below a level that returned rows. */
const DASHBOARD_NESTED_LOADS_COLD: [number, number] = [3, 0];
/** M1: what `node scripts/readiness/query-count.mjs dashboard` prints. */
const DASHBOARD_APP_ROUND_TRIPS_COLD = 161;
const DASHBOARD_APP_ROUND_TRIPS_WARM = 161;
/** "file › function" -> [app, admin] for the cold render. */
const DASHBOARD_COLD_BY_FUNCTION: Record<string, [number, number]> = {
  "src/lib/session-revocation.ts › (anonymous)": [0, 1],
  "src/lib/auth.ts › (anonymous)": [0, 1],
  "src/app/(student)/layout.tsx › StudentLayout": [4, 0],
  "src/app/(student)/dashboard/page.tsx › DashboardPage": [2, 0],
  "src/lib/progression/fetch-readiness-data.ts › fetchStudentReadinessData": [8, 0],
  "src/lib/dashboard/readers.ts › readOverview": [7, 0],
  "src/lib/dashboard/readers.ts › readActivity": [1, 0],
  "src/lib/dashboard/tasks.ts › (anonymous)": [2, 0],
  "src/lib/dashboard/support.ts › readSupport": [2, 0],
  "src/lib/progression/student-next-step.ts › getStudentNextStep": [9, 0],
  "src/lib/student-alerts.ts › countStudentVisibleAlerts": [2, 0],
  "src/lib/student-alerts.ts › countStudentVisibleAlertsOfType": [1, 0],
  "src/lib/sage/panel-data.ts › getLatestPanelSpec": [1, 0],
  "src/lib/mood.ts › hasMoodEntryToday": [1, 0],
};

const STUDENT_ID = "stu-readiness-001";
const NOW = new Date("2026-11-10T15:00:00.000Z");
const SESSION_COOKIE = "vq-session";

process.env.JWT_SECRET = "readiness-query-count-jwt-secret-for-tests-only";
const sessionToken = signToken(STUDENT_ID, "student", 0);
const progressionState = JSON.stringify(createInitialState());

const taskRow = {
  id: "task-1", studentId: STUDENT_ID, createdById: "tch-1", appointmentId: null,
  title: "Finish your resume", description: null, status: "open", priority: "normal",
  dueAt: null, completedAt: null, createdAt: NOW, updatedAt: NOW,
};

const counter = createQueryCounter({
  // Session (admin client).
  "admin:sageConfirmationUse.findUnique": null,
  "admin:student.findUnique": {
    id: STUDENT_ID, studentId: "readiness-student", displayName: "Riley Fixture",
    role: "student", sessionVersion: 0, isActive: true, demoAccount: null,
  },
  // Layout and page.
  "goal.count": 2,
  "progression.findUnique": { state: progressionState },
  "orientationProgress.count": 3,
  "securityQuestionAnswer.findMany": SECURITY_QUESTIONS.map((question) => ({ questionKey: question.key })),
  "notificationPreference.findUnique": null,
  "formSubmission.count": 1,
  // Readiness.
  "orientationItem.count": 8,
  "goal.findFirst": null,
  "certification.count": 0,
  "portfolioItem.count": 1,
  "resumeData.findUnique": { id: "resume-1" },
  "publicCredentialPage.findUnique": null,
  // Overview, activity, tasks.
  "certification.findMany": [{
    id: "cert-1", studentId: STUDENT_ID, certType: "ready-to-work", status: "in_progress",
    verificationStatus: null,
    requirements: [{ id: "req-1", templateId: "tpl-1", completed: true, verifiedBy: null }],
  }],
  "certTemplate.findMany": [{ id: "tpl-1", certType: "ready-to-work", required: true, needsFile: false, needsVerify: true }],
  "studentClassEnrollment.findFirst": { class: { requirements: [{ status: "required" }] } },
  "application.count": 1,
  "formSubmission.findFirst": { status: "approved" },
  "studentTask.findMany": [taskRow],
  "studentTask.count": 1,
  // Support and next step.
  "careerDiscovery.findUnique": { status: "complete" },
  "message.count": 6,
  "studentSavedJob.count": 1,
  "studentAlert.count": 1,
  "appointment.findFirst": { id: "appt-1", title: "Advising check-in", startsAt: NOW, locationLabel: "Room 2" },
  "orientationItem.findMany": [{ id: "item-1", label: "Sign the attendance policy" }],
  "sagePanel.findFirst": null,
  "moodEntry.findFirst": null,
});

mock.module("@/lib/db", { exports: counter.dbModule });
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
      throw new Error(`The fixture student was redirected to ${to}; the dashboard did not render.`);
    },
  },
});
// Node does not process CSS modules.
mock.module("@/components/dashboard/dashboard.module.css", { exports: { default: { workspace: "workspace" } } });

// Client components are stubbed: they run no server queries. Each stub renders
// the server-rendered nodes it is handed, so server components passed as props
// still run. CLIENT_COMPONENT_SOURCES is checked below.
const CLIENT_COMPONENT_SOURCES = [
  "src/components/ui/NavBar.tsx",
  "src/components/ui/NotificationProvider.tsx",
  "src/components/progression/ProgressionProvider.tsx",
  "src/app/(student)/dashboard/DashboardClient.tsx",
  "src/components/student/SmsReconsentNotice.tsx",
  "src/components/dashboard/MoodCheckInCard.tsx",
];
const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
interface DashboardClientProps {
  intro?: ReactNode;
  moodContent?: ReactNode;
  initialOverview?: unknown;
  initialActivity?: unknown;
  initialTasks?: unknown;
  initialSupport?: unknown;
}
const dashboardClientRenders: DashboardClientProps[] = [];
mock.module("@/components/ui/NavBar", { exports: { default: () => null } });
mock.module("@/components/ui/NotificationProvider", { exports: { default: passThrough } });
mock.module("@/components/progression/ProgressionProvider", { exports: { default: passThrough } });
mock.module("@/app/(student)/dashboard/DashboardClient", {
  exports: {
    default: (props: DashboardClientProps) => {
      dashboardClientRenders.push(props);
      return <>{props.intro}{props.moodContent}</>;
    },
  },
});
mock.module("@/components/student/SmsReconsentNotice", { exports: { SmsReconsentNotice: () => null } });
mock.module("@/components/dashboard/MoodCheckInCard", {
  exports: { MoodCheckInCard: () => <p>mood-check-in-card</p> },
});

interface Render {
  html: string;
  queries: readonly RecordedQuery[];
  transactions: readonly RecordedTransaction[];
  errors: unknown[];
}

let cold: Render;
let warm: Render;

async function renderDashboard(
  StudentLayout: typeof import("@/app/(student)/layout").default,
  DashboardPage: typeof import("@/app/(student)/dashboard/page").default,
): Promise<Render> {
  const errors: unknown[] = [];
  const section = await counter.section(async () => {
    const { prelude } = await prerenderToNodeStream(
      <StudentLayout><DashboardPage /></StudentLayout>,
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
  const { default: StudentLayout } = await import("@/app/(student)/layout");
  const { default: DashboardPage } = await import("@/app/(student)/dashboard/page");
  cold = await renderDashboard(StudentLayout, DashboardPage);
  warm = await renderDashboard(StudentLayout, DashboardPage);
});

describe("M1: student dashboard query count", () => {
  it("renders the whole dashboard for the fixture student, so no reader's queries are missing", () => {
    assert.deepEqual(cold.errors, []);
    assert.deepEqual(warm.errors, []);
    assert.match(cold.html, /Your Dashboard/);
    assert.match(cold.html, /mood-check-in-card/);
    assert.doesNotMatch(cold.html, /could not load/);
    const props = dashboardClientRenders[0];
    assert.ok(props, "DashboardClient was not rendered");
    for (const region of ["initialOverview", "initialActivity", "initialTasks", "initialSupport"] as const) {
      assert.notEqual(props[region], undefined, `${region} was rejected, so its reader stopped early`);
    }
  });

  it("stubs only client components", () => {
    for (const source of CLIENT_COMPONENT_SOURCES) {
      assert.match(readFileSync(source, "utf8"), /^\s*["']use client["']/, `${source} is not a client component`);
    }
  });

  it("cold render issues the pinned number of queries on each client", (t) => {
    for (const line of formatQueryBreakdown("M1 dashboard, cold", cold.queries).split("\n")) t.diagnostic(line);
    const summary = summarizeQueries(cold.queries);
    t.diagnostic(queryCountLine({ path: "dashboard", cache: "cold", queries: cold.queries, transactions: cold.transactions, readNotExecuted: 0 }));

    assert.equal(summary.app, DASHBOARD_APP_QUERIES_COLD);
    assert.equal(summary.admin, DASHBOARD_ADMIN_QUERIES_COLD);
    assert.deepEqual([summary.appNestedLoads, summary.adminNestedLoads], DASHBOARD_NESTED_LOADS_COLD);
    assert.equal(estimateRoundTrips(cold.queries, cold.transactions).app.roundTrips, DASHBOARD_APP_ROUND_TRIPS_COLD);
  });

  it("cold render's queries come from the pinned functions", () => {
    assert.deepEqual(countsByFunction(cold.queries), DASHBOARD_COLD_BY_FUNCTION);
  });

  it("warm render issues the pinned number of queries on each client", (t) => {
    for (const line of formatQueryBreakdown("M1 dashboard, warm", warm.queries).split("\n")) t.diagnostic(line);
    const summary = summarizeQueries(warm.queries);
    t.diagnostic(queryCountLine({ path: "dashboard", cache: "warm", queries: warm.queries, transactions: warm.transactions, readNotExecuted: 0 }));

    assert.equal(summary.app, DASHBOARD_APP_QUERIES_WARM);
    assert.equal(summary.admin, DASHBOARD_ADMIN_QUERIES_WARM);
    assert.equal(estimateRoundTrips(warm.queries, warm.transactions).app.roundTrips, DASHBOARD_APP_ROUND_TRIPS_WARM);
  });
});
