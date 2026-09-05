import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BENCH_INSTRUCTOR, BENCH_JOURNEY_STUDENT } from "./bench-fixtures";
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
 * Requires the fixture seed (idempotent — reruns are safe):
 *
 *   npx tsx scripts/bench/seed-cohort.ts
 *
 * Each route is navigated REPEATS times so the scorer has a real
 * distribution to take a p95 over rather than a single noisy sample.
 * Navigation Timing entries are read from the freshly-loaded document after
 * each `page.goto` (Chromium/WebKit/Firefox each start a fresh
 * `performance` object per document, so `getEntriesByType("navigation")[0]`
 * is always that navigation's own entry, never a stale one from the page
 * before it).
 */

const VIEWPORT = { width: 375, height: 667 } as const;
const REPEATS = 5;

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
    const studentContext = await loginContext(browser, BENCH_JOURNEY_STUDENT);
    const teacherContext = await loginContext(browser, BENCH_INSTRUCTOR);
    const byRoute: Record<string, { route: string; samples: NavSample[]; failures: number }> = {};

    try {
      const studentPage = await studentContext.newPage();
      await studentPage.setViewportSize(VIEWPORT);
      const teacherPage = await teacherContext.newPage();
      await teacherPage.setViewportSize(VIEWPORT);

      for (const spec of ROUTES) {
        const page = spec.role === "student" ? studentPage : teacherPage;
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
