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
 * Caches under this renderer (proved by measurement-renderer-caches.test.tsx):
 * - `React.cache` does NOT memoize here. The render runs `react-dom/static`
 *   with no `react-server` export condition, so `react` resolves to its client
 *   build, whose `cache(fn)` is a pass-through. Production server components
 *   use the react-server build, where it memoizes per request. A loader wrapped
 *   only in `React.cache` would therefore count every caller here, an
 *   overcount, and a later change that dedupes reads that way would not show.
 *   A builder adding a per-request loader must make the measurement see it:
 *   either key the loader on a request-scoped object the code already passes
 *   down (so its memo works under any renderer), or mock `react` in this test
 *   with a `cache` that memoizes and is reset between the cold and warm
 *   renders, so each render is one request. Do not run the test under
 *   `--conditions=react-server`: `react-dom/static` is not served there.
 * - The process cache `cached()` (src/lib/cache.ts) IS live, including its
 *   in-flight coalescing, which is why the warm render differs from the cold.
 *
 * Read, not executed: 0 queries. `src/proxy.ts` and the root layout
 * (`src/app/layout.tsx:45-47`) run on every request and read only cookies and
 * headers. Nothing on this path had to be counted by reading.
 *
 * The fixture student's branches:
 * - signed in as a real student (not a demo account), session not revoked
 * - recovery questions set, so no redirect to /recovery-setup
 * - the current Sage notice acknowledged, so no redirect to /sage-notice
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
import { unansweredLoadProblems, type UnansweredAllowances } from "./unanswered-loads";
import { DASHBOARD_FIXTURES, DASHBOARD_JWT_SECRET, DASHBOARD_STUDENT_ID } from "./dashboard-fixtures.test-support";
import { signToken } from "@/lib/session-token";

// Set to the measured value. A change to any of these is a change in what the
// dashboard costs, and belongs in the diff that caused it.
// The 2026-11-10 review estimated about 39 app queries by reading. It missed
// the mood check-in gate (1) and counted the reader block as 24, not 25.
// H6 (Sage notice gate in the student layout) added 1: 40 to 41.
// F2 step 2 (2026-11-10): 41 to 34. The layout and page share one read of the
// planning-goal count, progression and orientation count (getStudentShell),
// and the page reads every other fact once, grouped into transactions
// (src/lib/dashboard/student-dashboard.ts): 7 repeated reads gone, and 25
// reads now cost 1 round trip each inside three transactions instead of 4.
const DASHBOARD_APP_QUERIES_COLD = 34;
/** The session lookup and its revocation check; both cached for seconds. */
const DASHBOARD_ADMIN_QUERIES_COLD = 2;
/**
 * The shell is kept per student once a Progression row exists, so warm skips its 3 reads.
 * F2 step 3: both one-time gates are satisfied for this student and kept, so warm skips 2 more.
 * F2 step 4: the orientation total and the Ready-to-Work templates are global and kept: 2 more.
 * F2b item 3 (2026-11-10): a page render reads the shell fresh (readPageShell), once per
 * request for the layout and the page together, so warm reads its 3 again: 27 to 30.
 */
const DASHBOARD_APP_QUERIES_WARM = 30;
const DASHBOARD_ADMIN_QUERIES_WARM = 0;
/** [app, admin] nested relation loads, counted only below a level that returned rows. */
const DASHBOARD_NESTED_LOADS_COLD: [number, number] = [3, 0];
/**
 * M1: app plus admin round trips, what `node scripts/readiness/query-count.mjs dashboard` prints.
 * An admin call costs a round trip too, so both clients count.
 * F2 step 2: 167 to 79 cold, 165 to 70 warm. Step 3 (gates kept once satisfied): warm 70 to 62.
 * Step 4 (global rows kept): warm 62 to 54. F2b item 3 (shell fresh on page loads): warm 54 to 61;
 * cold unchanged, because the layout and the page share one shell read per request.
 */
const DASHBOARD_ROUND_TRIPS_COLD = 79;
const DASHBOARD_ROUND_TRIPS_WARM = 61;
/** "file › function" -> [app, admin] for the cold render. */
const DASHBOARD_COLD_BY_FUNCTION: Record<string, [number, number]> = {
  "src/lib/session-revocation.ts › (anonymous)": [0, 1],
  "src/lib/auth.ts › (anonymous)": [0, 1],
  "src/lib/consent.ts › hasAcknowledgedSageNotice": [1, 0],
  "src/lib/dashboard/student-gates.ts › readQuestionKeys": [1, 0],
  "src/lib/dashboard/signals.ts › readShell": [3, 0],
  "src/lib/dashboard/tasks.ts › (anonymous)": [2, 0],
  "src/lib/sage/panel-data.ts › getLatestPanelSpec": [1, 0],
  "src/lib/dashboard/signals.ts › readReadinessSignals": [5, 0],
  "src/lib/dashboard/live.ts › readCounts": [4, 0],
  "src/lib/student-alerts.ts › countStudentVisibleAlerts": [1, 0],
  "src/lib/student-alerts.ts › countStudentVisibleAlertsOfType": [1, 0],
  "src/lib/dashboard/globals.ts › readOrientationTotal": [1, 0],
  "src/lib/dashboard/globals.ts › readReadyToWorkTemplates": [1, 0],
  "src/lib/dashboard/live.ts › readPageOnly": [2, 0],
  "src/lib/dashboard/signals.ts › readNextStepSignals": [6, 0],
  "src/lib/dashboard/signals.ts › readOverviewSignals": [4, 0],
  "src/lib/mood.ts › hasMoodEntryToday": [1, 0],
};
/**
 * Calls on the measured path that no fixture answers although they load a
 * nested relation, each with why. Anything else unanswered with a nested
 * relation fails the test below: the empty default hides what real rows load.
 */
const DASHBOARD_UNANSWERED_WITH_NESTED: UnansweredAllowances = {};

const STUDENT_ID = DASHBOARD_STUDENT_ID;
const SESSION_COOKIE = "vq-session";

process.env.JWT_SECRET = DASHBOARD_JWT_SECRET;
const sessionToken = signToken(STUDENT_ID, "student", 0);

const counter = createQueryCounter(DASHBOARD_FIXTURES);

mock.module("@/lib/db", { exports: counter.dbModule });
// Each render below is one request. React's `cache` passes through under this
// renderer (see the header), so stand in a memo that lasts one render: what
// production's react-server build does for the layout and page of a request.
let request = 0;
mock.module("@/lib/dashboard/per-request", {
  exports: {
    perRequest: <A extends readonly (string | number)[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, { request: number; value: R }>();
      return (...args: A): R => {
        const key = args.join("\u0000");
        const hit = memo.get(key);
        if (hit && hit.request === request) return hit.value;
        const value = fn(...args);
        memo.set(key, { request, value });
        return value;
      };
    },
  },
});
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
  request += 1;
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


/** App plus admin round trips: the gate's number. */
function allRoundTrips(queries: readonly RecordedQuery[], transactions: readonly RecordedTransaction[]): number {
  const { app, admin } = estimateRoundTrips(queries, transactions);
  return app.roundTrips + admin.roundTrips;
}

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
    assert.equal(allRoundTrips(cold.queries, cold.transactions), DASHBOARD_ROUND_TRIPS_COLD);
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
    assert.equal(allRoundTrips(warm.queries, warm.transactions), DASHBOARD_ROUND_TRIPS_WARM);
  });

  it("answers every call that loads a nested relation, or names it with a reason", () => {
    assert.deepEqual(unansweredLoadProblems([...cold.queries, ...warm.queries], DASHBOARD_UNANSWERED_WITH_NESTED), []);
  });
});
