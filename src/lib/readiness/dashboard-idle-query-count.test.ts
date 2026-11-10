/**
 * M2: database statements per open student dashboard per minute, at idle.
 *
 * What the number is: an open dashboard with nobody touching it still polls.
 * Each region in `DASHBOARD_REGIONS` (src/lib/dashboard/query.ts) refetches
 * its endpoint every `regionPollMs[region]` milliseconds while the tab is
 * visible. This test plays that schedule for `WINDOW_MS` of simulated time
 * against the real route handlers (session lookup, RLS wrapper, readers),
 * with `@/lib/db` replaced by the query counter, and divides the statements
 * by the minutes simulated.
 *
 * The clock is mocked (`mock.timers`, Date only), so every in-process cache
 * expires exactly as it would: `cached()` entries, including the 10 s session
 * cache, are dropped once their TTL passes. Requests due at the same moment
 * are sent together, as the browser does when intervals line up, so they
 * share in-flight cache fills.
 *
 * What it counts: statements, app plus admin. A statement is a call after
 * Prisma's admin dataloader batching, plus each nested relation load, as
 * `estimateRoundTrips` counts them. Admin statements count: moving a read to
 * `prismaAdmin` costs the database the same and skips row-level security.
 *
 * What it does not count: focus and reconnect refetches, refetches after a
 * mutation or a pushed notification, and the notification stream itself
 * (`/api/notifications/stream`), which is one long request, not a poll. At
 * idle none of those fire.
 */
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import {
  createQueryCounter,
  estimateRoundTrips,
  formatQueryBreakdown,
  type RecordedQuery,
  type RecordedTransaction,
} from "@/lib/query-counter.test-support";
import { signToken } from "@/lib/session-token";
import {
  DASHBOARD_FIXTURES,
  DASHBOARD_JWT_SECRET,
  DASHBOARD_NOW,
  DASHBOARD_STUDENT_ID,
} from "./dashboard-fixtures.test-support";

/**
 * Pinned. A change is a change in what an idle dashboard costs and belongs in
 * the diff that caused it. 2026-11-10 baseline: four regions every 30 s; per
 * cycle 32 app calls, 3 nested relation loads and the 2 admin session
 * statements, so 37 a cycle and 74 a minute. The earlier estimate of "about
 * 64" counted app calls only (32 x 2).
 */
const IDLE_STATEMENTS_PER_MINUTE = 74;

/** Long enough to hold whole cycles of every interval the client uses. */
const WINDOW_MS = 10 * 60_000;
const SESSION_COOKIE = "vq-session";

process.env.JWT_SECRET = DASHBOARD_JWT_SECRET;
const sessionToken = signToken(DASHBOARD_STUDENT_ID, "student", 0);
const counter = createQueryCounter(DASHBOARD_FIXTURES);

mock.module("@/lib/db", { exports: counter.dbModule });
mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) => (name === SESSION_COOKIE ? { name, value: sessionToken } : undefined),
    }),
    headers: async () => new Headers(),
  },
});

type Handler = (request: Request) => Promise<Response>;
interface Poll { readonly region: string; readonly url: string; readonly handler: Handler }
interface IdleResult {
  readonly queries: readonly RecordedQuery[];
  readonly transactions: readonly RecordedTransaction[];
  readonly ticks: number;
  readonly statuses: readonly number[];
}

async function loadPolls(): Promise<{ polls: readonly Poll[]; pollMs: Readonly<Record<string, number>> }> {
  const { DASHBOARD_REGIONS, regionPollMs } = await import("@/lib/dashboard/query");
  const { taskQuerySchema } = await import("@/lib/dashboard/task-schemas");
  const taskParams = new URLSearchParams(Object.entries(taskQuerySchema.parse({})).map(([k, v]) => [k, String(v)]));
  const handlers: Record<(typeof DASHBOARD_REGIONS)[number], { url: string; handler: Handler }> = {
    overview: { url: "/api/dashboard/overview", handler: (await import("@/app/api/dashboard/overview/route")).GET },
    activity: { url: "/api/dashboard/activity", handler: (await import("@/app/api/dashboard/activity/route")).GET },
    support: { url: "/api/dashboard/support", handler: (await import("@/app/api/dashboard/support/route")).GET },
    tasks: { url: `/api/tasks?${taskParams}`, handler: (await import("@/app/api/tasks/route")).GET },
  };
  return { polls: DASHBOARD_REGIONS.map((region) => ({ region, ...handlers[region] })), pollMs: regionPollMs };
}

/** Moments in (0, window] when each poll fires, grouped by moment. */
function schedule(polls: readonly Poll[], pollMs: Readonly<Record<string, number>>): Map<number, Poll[]> {
  const byMoment = new Map<number, Poll[]>();
  for (const poll of polls) {
    for (let at = pollMs[poll.region]; at <= WINDOW_MS; at += pollMs[poll.region]) {
      byMoment.set(at, [...(byMoment.get(at) ?? []), poll]);
    }
  }
  return new Map([...byMoment].sort(([a], [b]) => a - b));
}

async function playIdleWindow(): Promise<IdleResult> {
  const { polls, pollMs } = await loadPolls();
  const moments = schedule(polls, pollMs);
  const start = DASHBOARD_NOW.getTime();
  const statuses: number[] = [];
  const section = await counter.section(async () => {
    for (const [at, due] of moments) {
      mock.timers.setTime(start + at);
      const responses = await Promise.all(due.map((poll) => poll.handler(new Request(`http://localhost${poll.url}`))));
      statuses.push(...responses.map((response) => response.status));
    }
  });
  return { queries: section.queries, transactions: section.transactions, ticks: moments.size, statuses };
}

let idle: IdleResult;

before(async () => {
  mock.timers.enable({ apis: ["Date"], now: DASHBOARD_NOW.getTime() });
  idle = await playIdleWindow();
});
after(() => { mock.timers.reset(); });

function perMinute(result: IdleResult): { app: number; admin: number; total: number } {
  const { app, admin } = estimateRoundTrips(result.queries, result.transactions);
  const minutes = WINDOW_MS / 60_000;
  return { app: app.statements / minutes, admin: admin.statements / minutes, total: (app.statements + admin.statements) / minutes };
}

describe("M2: idle dashboard statements per minute", () => {
  it("every poll in the window succeeds, so no reader stopped early", () => {
    assert.ok(idle.statuses.length > 0, "nothing polled");
    assert.deepEqual(idle.statuses.filter((status) => status !== 200), []);
  });

  it("issues the pinned number of statements per minute", (t) => {
    for (const line of formatQueryBreakdown("M2 dashboard idle, whole window", idle.queries).split("\n")) t.diagnostic(line);
    const rate = perMinute(idle);
    t.diagnostic(
      `IDLE_RATE path=dashboard-idle windowMs=${WINDOW_MS} ticks=${idle.ticks}` +
        ` appPerMinute=${rate.app} adminPerMinute=${rate.admin} perMinute=${rate.total}`,
    );
    assert.equal(rate.total, IDLE_STATEMENTS_PER_MINUTE);
  });
});
