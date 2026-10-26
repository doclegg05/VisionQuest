import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * Benchmark data collector: server-response and DOMContentLoaded timing at
 * 375x667 for the four hottest pages (design §4.7 "Page timing"; task's
 * narrower list over the design's five-route table: the student home, the
 * teacher dashboard, the Connect console, and the student jobs page — which
 * is `/career`, since `/jobs` is a redirect stub to `/career#jobs`, the
 * repo's retired-route pattern).
 *
 * Same split as e2e/bench-touch-targets.spec.ts: this spec ONLY collects raw
 * data (no pass/fail here) and writes it to
 * reports/benchmarks/raw/page-timing.json; scripts/bench/suites/page-timing.mjs
 * reads that file and applies the floor.
 *
 * Logs in as the standard seeded E2E_STUDENT/E2E_TEACHER (e2e/fixtures.ts,
 * seeded by scripts/seed-e2e-users.ts, the SAME accounts
 * bench-touch-targets.spec.ts and bench-axe-authenticated.spec.ts already
 * use), NOT the synthetic benchmark cohort — this spec only needs a
 * logged-in student and teacher to render four pages, it has no need for
 * the cohort's Connect-specific seeded state (a live proposed connection,
 * work profiles, ...) the way bench-connect-journey.spec.ts genuinely does.
 *
 * PR review round 2/3, correcting the original BENCH_JOURNEY_STUDENT/
 * BENCH_INSTRUCTOR choice: `/api/auth/login` binds on `login:user:<studentId>`
 * at 5 attempts (tighter than the per-IP cap), and this spec's original
 * cbench login also 401ed unless ci.yml's cohort-seed step had already run
 * — a dependency this spec never needed. ci.yml's "Collect browser
 * benchmark data" step now runs each collector in its own `playwright test`
 * invocation with scripts/seed-e2e-users.ts re-run immediately before it
 * (clearing both the fixture rows and their rate-limit buckets — see that
 * step's own header for why), which already isolates every collector's
 * login budget from every other's. Using E2E_STUDENT/E2E_TEACHER here is
 * defense in depth on top of that fix, not a substitute for it: this spec
 * has no reason to touch the cbench accounts at all, so it does not share
 * fate with connect-journey/journey-day1/journey-teacher-loop's login
 * budget regardless of how that step is shaped.
 *
 * Each route gets ONE untimed, discarded warm-up navigation, then REPEATS
 * timed navigations so the scorer has a real distribution to take a p95
 * over rather than a single noisy sample. Without the warm-up, the FIRST of
 * the REPEATS navigations is the page's genuinely cold first load (fresh
 * route compilation, cold caches), and scripts/lib/percentile.mjs's
 * nearest-rank p95 resolves to the literal maximum recorded sample at any
 * REPEATS below 20 (ceil(0.95*n) reaches n for every n<20 — see that file),
 * so the reported "p95" WAS that one cold sample, not a tail statistic over
 * steady-state loads (PR review round 2). Discarding a warm-up nav first
 * means the maximum among the REPEATS timed samples is a worst-of-the-
 * steady-state number instead.
 *
 * Navigation Timing entries are read from the freshly-loaded document after
 * each `page.goto` (Chromium/WebKit/Firefox each start a fresh
 * `performance` object per document, so `getEntriesByType("navigation")[0]`
 * is always that navigation's own entry, never a stale one from the page
 * before it).
 */

const VIEWPORT = { width: 375, height: 667 } as const;
const REPEATS = 8;

interface RouteSpec {
  id: string;
  route: string;
  role: "student" | "teacher";
}

const ROUTES: RouteSpec[] = [
  { id: "dashboard", route: "/dashboard", role: "student" },
  { id: "career", route: "/career", role: "student" },
  { id: "teacher", route: "/teacher", role: "teacher" },
  { id: "teacher_connect", route: "/teacher/connect", role: "teacher" },
];

const OUTPUT_PATH = join(process.cwd(), "reports/benchmarks/raw/page-timing.json");

interface NavSample {
  ttfbMs: number;
  dclMs: number;
}

async function measureRoute(page: import("@playwright/test").Page, route: string): Promise<NavSample | null> {
  await page.goto(route, { waitUntil: "load" });
  return page.evaluate(() => {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!entry) return null;
    return {
      // responseStart is time-to-first-byte relative to navigation start —
      // the "server response time" the design and task both name.
      ttfbMs: entry.responseStart,
      dclMs: entry.domContentLoadedEventEnd,
    };
  });
}

test.describe("Benchmark data: page timing at 375px", () => {
  test("collects server-response and DOMContentLoaded timing for the four hottest pages", async ({ browser }) => {
    const studentContext = await loginContext(browser, E2E_STUDENT);
    const teacherContext = await loginContext(browser, E2E_TEACHER);
    const byRoute: Record<string, { route: string; samples: NavSample[]; failures: number }> = {};

    try {
      const studentPage = await studentContext.newPage();
      await studentPage.setViewportSize(VIEWPORT);
      const teacherPage = await teacherContext.newPage();
      await teacherPage.setViewportSize(VIEWPORT);

      for (const spec of ROUTES) {
        const page = spec.role === "student" ? studentPage : teacherPage;

        // Untimed, discarded — cold route compilation and cache misses live
        // here, not in the recorded samples. See the header comment.
        await measureRoute(page, spec.route);

        const samples: NavSample[] = [];
        let failures = 0;
        for (let i = 0; i < REPEATS; i += 1) {
          const sample = await measureRoute(page, spec.route);
          if (sample) samples.push(sample);
          else failures += 1;
        }
        byRoute[spec.id] = { route: spec.route, samples, failures };
      }
    } finally {
      await studentContext.close();
      await teacherContext.close();
    }

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          viewport: VIEWPORT,
          repeats: REPEATS,
          byRoute,
        },
        null,
        2,
      ),
    );
  });
});
