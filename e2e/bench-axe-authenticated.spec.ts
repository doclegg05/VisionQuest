import { test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * Benchmark data collector: authenticated axe violations, per route.
 *
 * Companion to config/benchmarks/axe-authenticated.json /
 * scripts/bench/suites/axe-authenticated.mjs (docs/superpowers/plans/
 * 2026-09-05-benchmark-suite.md, §4.9 "Authenticated axe scan" — watch tier,
 * "33 known violations today ... burn down to 0, then gate").
 *
 * This is a SIBLING of e2e/a11y-authenticated.spec.ts, not a replacement —
 * that spec keeps its own zero-violation `expect.soft` assertions exactly as
 * they are (this task's instructions: "Do not change the existing spec's
 * zero-violation assertion; add a sibling spec that reports rather than
 * asserts"). This spec makes NO assertion at all; it only runs the same axe
 * scan over the same routes and writes violation counts per route to
 * reports/benchmarks/raw/axe-authenticated.json for the scorer to read,
 * which is the whole point of a `watch`-tier benchmark: numbers without a
 * gate blocking anything on them yet.
 *
 * Requires the fixture seed (idempotent — reruns are safe):
 *
 *   npx tsx scripts/seed-e2e-users.ts
 */

const STUDENT_ROUTES = ["/dashboard", "/goals", "/learning", "/career", "/portfolio"] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const OUTPUT_PATH = join(process.cwd(), "reports/benchmarks/raw/axe-authenticated.json");

interface RouteResult {
  route: string;
  role: "student" | "teacher";
  violationCount: number;
  violations: Array<{ id: string; impact: string | null | undefined; nodeCount: number }>;
}

async function scanRoute(page: Page, path: string, role: "student" | "teacher"): Promise<RouteResult> {
  await page.goto(path);
  await page.waitForTimeout(1_500);
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return {
    route: path,
    role,
    violationCount: results.violations.length,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodeCount: v.nodes.length,
    })),
  };
}

test.describe("Benchmark data: authenticated axe scan (report only, no assertion)", () => {
  test("scans student and teacher routes and records violation counts", async ({ browser }) => {
    const routeResults: RouteResult[] = [];

    const studentContext = await loginContext(browser, E2E_STUDENT);
    try {
      const page = await studentContext.newPage();
      for (const route of STUDENT_ROUTES) {
        routeResults.push(await scanRoute(page, route, "student"));
      }
    } finally {
      await studentContext.close();
    }

    const teacherContext = await loginContext(browser, E2E_TEACHER);
    try {
      const page = await teacherContext.newPage();
      routeResults.push(await scanRoute(page, "/teacher", "teacher"));

      // Same resolution as e2e/a11y-authenticated.spec.ts: the queue entry
      // carries the seeded student's internal id for the detail deep link.
      const queueResponse = await teacherContext.request.get("/api/teacher/intervention-queue");
      if (queueResponse.ok()) {
        const queue = (await queueResponse.json()) as {
          queue: Array<{ studentId: string; publicStudentId: string }>;
        };
        const seeded = queue.queue.find((entry) => entry.publicStudentId === E2E_STUDENT.login);
        if (seeded) {
          // Navigate to the real resolved path, but RECORD the route shape,
          // never the resolved id — `details` in the committed benchmark
          // result must never carry a student identifier (security review,
          // 2026-09-05), even the seeded e2e fixture's own.
          const detailPath = `/teacher/students/${seeded.studentId}`;
          const detailRouteShape = "/teacher/students/:id";
          await page.goto(detailPath);
          await page.getByRole("button", { name: "Coach" }).waitFor({ timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(500);
          const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
          routeResults.push({
            route: detailRouteShape,
            role: "teacher",
            violationCount: results.violations.length,
            violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodeCount: v.nodes.length })),
          });
        }
      }
    } finally {
      await teacherContext.close();
    }

    const violationsTotal = routeResults.reduce((sum, r) => sum + r.violationCount, 0);

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          axeTags: AXE_TAGS,
          violationsTotal,
          routes: routeResults,
        },
        null,
        2,
      ),
    );
  });
});
