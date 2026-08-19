import { test, expect } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { E2E_JOURNEY_STUDENT, E2E_STUDENT } from "./fixtures";
import { loginContext } from "./helpers/auth";
import { createPrisma, resetStudentToDayOne } from "./helpers/db";

/**
 * E2E: the day-1 student journey.
 *
 * Requires the fixture seed (idempotent — reruns are safe):
 *
 *   npx tsx scripts/seed-e2e-users.ts
 *
 * Two fixture students split the journey at the point where today's product
 * actually splits it: the day-1 student exercises sign-in → welcome flow →
 * path choice; the established student (seeded confirmed goal) sees the
 * dashboard as home with exactly one "Current Target" and an actionable CTA.
 *
 * KNOWN GAPS this spec works around rather than hides (findings for a later
 * phase, verified against the running app 2026-08-19):
 *
 *  1. The welcome flow self-destructs on first load: the (student) layout's
 *     ProgressionProvider calls GET /api/progression on mount, which awards
 *     daily-checkin XP and CREATES the Progression row — and any server
 *     re-render of /welcome after that (the post-login router.refresh(), a
 *     reload) redirects the student to /dashboard because "they have
 *     activity". In practice a brand-new student can be bounced out of the
 *     welcome flow before reading step 0. This test therefore resets the
 *     journey student to day-1 state AFTER the login landing settles, then
 *     enters /welcome via the /dashboard redirect deterministically.
 *
 *  2. Welcome path choice 3 ("View My Employment Journey Map" → /dashboard)
 *     is a loop for a genuinely day-1 student — /dashboard redirects
 *     zero-activity students straight back to /welcome, and completing
 *     quick-win orientation items does not change that (orientation
 *     completion writes no Progression row). It only "works" today because
 *     of gap 1. This test exercises path choice 1, which works by design.
 */

test.describe("Day-1 student journey", () => {
  let prisma: PrismaClient;

  test.beforeAll(() => {
    prisma = createPrisma();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("new student signs in, lands on the welcome flow, and a path choice works", async ({ page }) => {
    // Real sign-in form — the actual day-1 entry path.
    await page.goto("/");
    await page.getByLabel(/username or email/i).fill(E2E_JOURNEY_STUDENT.login);
    await page.getByLabel(/password/i).fill(E2E_JOURNEY_STUDENT.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Login routes day-1 students toward /welcome, but the refresh-vs-
    // progression race (gap 1 above) means the first landing can be either
    // surface. Reaching an authenticated route at all proves the sign-in
    // (both routes bounce anonymous visitors back to "/").
    await page.waitForURL(/\/(welcome|dashboard)/, { timeout: 20_000 });

    // Park on a blank page so no mounted component can fire further
    // Progression-creating requests, let in-flight writes land, then restore
    // true day-1 state (same reset the seed applies).
    await page.goto("about:blank");
    await page.waitForTimeout(1_500);
    const journeyStudent = await prisma.student.findUnique({
      where: { studentId: E2E_JOURNEY_STUDENT.login },
      select: { id: true },
    });
    expect(journeyStudent, "journey student must be seeded").toBeTruthy();
    await resetStudentToDayOne(prisma, journeyStudent!.id);

    // Isolate the walkthrough from gap 1: GET /api/progression (fired by the
    // layout's ProgressionProvider on every page mount) is what creates the
    // Progression row that makes any /welcome re-render bounce to /dashboard
    // — under the dev server a hot-reload re-request mid-flow reproducibly
    // kills the flow. Abort just that call (the provider swallows the error)
    // so the welcome flow stays alive for the walkthrough; everything else,
    // including the quick-win POST /api/orientation, runs for real. Remove
    // this block once the self-destruct gap is fixed product-side.
    await page.route(
      (url) => url.pathname.endsWith("/api/progression"),
      (route) => route.abort(),
    );

    // Day-1 routing: /dashboard sends zero-activity students to /welcome.
    await page.goto("/dashboard");
    await page.waitForURL(/\/welcome/, { timeout: 20_000 });

    // Step 0 — personalized welcome.
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`welcome, ${E2E_JOURNEY_STUDENT.displayName}`, "i"),
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /let's get started/i }).click();

    // Step 1 — Meet Sage.
    await expect(page.getByRole("heading", { name: /meet sage/i })).toBeVisible();
    await page.getByRole("button", { name: /^next/i }).click();

    // Step 2 — quick wins. The seed guarantees at least one quick-win-
    // eligible orientation item and this test reset the journey student's
    // progress, so a quick win is always offered. Completing it writes a
    // real OrientationProgress row through POST /api/orientation.
    await expect(page.getByRole("heading", { name: /your first wins/i })).toBeVisible();
    const readButtons = page.getByRole("button", { name: /i've read this/i });
    await expect(readButtons.first()).toBeVisible();
    await readButtons.first().click();

    // Two legitimate continuations, depending on how many quick wins the
    // database offers: completing the ONLY one plays the readiness-score
    // animation and auto-advances; with more remaining, "Skip for now"
    // advances manually.
    const pathHeading = page.getByRole("heading", { name: /your path to employment/i });
    const skipButton = page.getByRole("button", { name: /skip for now/i });
    await expect(pathHeading.or(skipButton)).toBeVisible({ timeout: 10_000 });
    if (!(await pathHeading.isVisible())) {
      await skipButton.click();
    }
    await expect(pathHeading).toBeVisible({ timeout: 10_000 });

    // Step 3 — the recommended path choice routes to the Sage conversation.
    await page.getByRole("link", { name: /discover my career path/i }).click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 20_000 });
    await expect(page.getByLabel("Message to Sage")).toBeVisible({ timeout: 20_000 });
  });

  test("student with an active plan sees exactly one Current Target with an actionable CTA", async ({ browser }) => {
    const context = await loginContext(browser, E2E_STUDENT);
    try {
      const page = await context.newPage();
      await page.goto("/dashboard");

      // No welcome redirect — this student has a confirmed goal.
      await expect(page).toHaveURL(/\/dashboard/);

      // Exactly one Current Target...
      const currentTarget = page.getByText("Current Target", { exact: true });
      await expect(currentTarget).toHaveCount(1);
      await expect(currentTarget).toBeVisible();

      // ...with an actionable CTA. The journey engine puts orientation at
      // step 0, and the seeded student's orientation is deliberately kept
      // incomplete (one item pending teacher verification), so the one
      // Current Target must be the orientation step with its CTA pointing
      // at /orientation.
      const cta = page.getByTestId("current-target-cta");
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute("href", "/orientation");
      await expect(cta).not.toHaveText(/^\s*$/);
    } finally {
      await context.close();
    }
  });
});
