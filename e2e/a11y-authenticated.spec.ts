import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * E2E: Automated accessibility scans (axe-core) for AUTHENTICATED routes.
 *
 * Companion to e2e/a11y.spec.ts (public routes). Requires the fixture seed:
 *
 *   npx tsx scripts/seed-e2e-users.ts
 *
 * The bar is the same as the public suite — zero violations against the
 * WCAG 2.0/2.1 A+AA rulesets, fix the page, never filter the rule. Until
 * today's authenticated pages actually meet that bar, this spec lives in the
 * CI soak lane (`continue-on-error` step in .github/workflows/ci.yml, and
 * it is NOT part of `npm run test:a11y`): it runs on every push and fails
 * honestly, producing the red baseline for the page-fixing phase, without
 * blocking merges. Promote it to the gating step once the scans pass.
 *
 * Soft assertions: every route is scanned and reported even after the first
 * failure, so one CI run yields the full violation inventory.
 */

const STUDENT_ROUTES = [
  "/dashboard",
  "/goals",
  "/learning",
  "/career",
  "/portfolio",
] as const;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface RouteViolation {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: string[];
}

async function scan(page: Page): Promise<RouteViolation[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/**
 * Authenticated pages hydrate client panels after load; the dashboard also
 * holds an SSE stream open, so "networkidle" would never fire. Settle on
 * load + a short paint window instead.
 */
async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // A bounce to the landing page means the session cookie was not honored —
  // fail loudly rather than "passing" a scan of the sign-in form.
  await expect(page, `expected to stay on ${path} while authenticated`).not.toHaveURL(/\/$/);
  await page.waitForTimeout(1_500);
}

test.describe("Accessibility — authenticated routes (WCAG 2.x A/AA)", () => {
  test("student routes have no axe violations", async ({ browser }) => {
    const context = await loginContext(browser, E2E_STUDENT);
    try {
      const page = await context.newPage();
      for (const route of STUDENT_ROUTES) {
        await settle(page, route);
        const violations = await scan(page);
        expect
          .soft(violations, `axe violations on ${route} (student)`)
          .toEqual([]);
      }
    } finally {
      await context.close();
    }
  });

  test("teacher routes have no axe violations", async ({ browser }) => {
    const context = await loginContext(browser, E2E_TEACHER);
    try {
      const page = await context.newPage();

      // Resolve the seeded student's internal id through the same API the
      // dashboard uses — the queue entry carries the DB id for deep links.
      const queueResponse = await context.request.get(
        "/api/teacher/intervention-queue",
      );
      expect(queueResponse.ok()).toBe(true);
      const queue = (await queueResponse.json()) as {
        queue: Array<{ studentId: string; publicStudentId: string }>;
      };
      const seeded = queue.queue.find(
        (entry) => entry.publicStudentId === E2E_STUDENT.login,
      );
      if (!seeded) {
        throw new Error(
          `${E2E_STUDENT.login} not present in the intervention queue — run scripts/seed-e2e-users.ts`,
        );
      }

      const page1 = page;
      await settle(page1, "/teacher");
      expect.soft(await scan(page1), "axe violations on /teacher").toEqual([]);

      const detailPath = `/teacher/students/${seeded.studentId}`;
      await page.goto(detailPath);
      // Student detail loads client-side — wait for real content, not the
      // "Loading student data..." placeholder, before scanning.
      await expect(page.getByRole("button", { name: "Coach" })).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(500);
      expect
        .soft(await scan(page), `axe violations on ${detailPath} (student detail)`)
        .toEqual([]);
    } finally {
      await context.close();
    }
  });
});
