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
 * Two gaps this spec used to work around are now product behaviour it
 * asserts (fixed 2026-08-20, see src/lib/progression/welcome-routing.ts):
 *
 *  1. The flow no longer self-destructs. The (student) layout's
 *     ProgressionProvider still calls GET /api/progression on mount, and that
 *     call still creates the Progression row — but neither redirect reads
 *     that row any more, so the walkthrough survives the provider, a reload,
 *     and the quick-win writes it makes itself. This spec runs with nothing
 *     stubbed or aborted; if the self-destruct returns, it fails at step 0.
 *
 *  2. No path choice loops. Leaving the flow records an explicit completion
 *     fact, so a student who picks any of the three doors — including "View
 *     My Employment Journey Map", which lands on the very page that used to
 *     bounce them back — stays where they chose to go.
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
    // Restore true day-1 state BEFORE the browser touches anything, so the
    // walkthrough that follows is the student's real first session. (Reruns
    // need this: the previous run left a welcome-completion event behind.)
    const journeyStudent = await prisma.student.findUnique({
      where: { studentId: E2E_JOURNEY_STUDENT.login },
      select: { id: true },
    });
    expect(journeyStudent, "journey student must be seeded").toBeTruthy();
    await resetStudentToDayOne(prisma, journeyStudent!.id);

    // Real sign-in form — the actual day-1 entry path.
    await page.goto("/");
    await page.getByLabel(/username or email/i).fill(E2E_JOURNEY_STUDENT.login);
    await page.getByLabel(/password/i).fill(E2E_JOURNEY_STUDENT.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Login lands every student on /dashboard, which sends a day-1 student to
    // the welcome flow. Nothing is stubbed here: the ProgressionProvider that
    // used to end this walkthrough is mounted and firing.
    await page.waitForURL(/\/welcome/, { timeout: 20_000 });

    // Step 0 — personalized welcome.
    const step0Heading = page.getByRole("heading", {
      name: new RegExp(`welcome, ${E2E_JOURNEY_STUDENT.displayName}`, "i"),
    });
    await expect(step0Heading).toBeVisible();

    // The self-destruct, reproduced on purpose: by now the mounted
    // ProgressionProvider has called GET /api/progression at least once, so
    // the student HAS a Progression row. A reload used to hand them to
    // /dashboard here. It must not.
    await expect
      .poll(
        async () =>
          prisma.progression.count({ where: { studentId: journeyStudent!.id } }),
        { message: "the provider should have created the Progression row", timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page).toHaveURL(/\/welcome/);
    await expect(step0Heading).toBeVisible();

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
    // animation and auto-advances after a timer; with more remaining, "Skip
    // for now" advances manually. Poll rather than branch once — deciding
    // from a single snapshot races the auto-advance, which detaches the Skip
    // button out from under the click.
    const pathHeading = page.getByRole("heading", { name: /your path to employment/i });
    const skipButton = page.getByRole("button", { name: /skip for now/i });
    await expect
      .poll(
        async () => {
          if (await pathHeading.isVisible()) return true;
          if (await skipButton.isVisible()) {
            await skipButton.click({ timeout: 2_000 }).catch(() => {});
          }
          return pathHeading.isVisible();
        },
        { message: "the path chooser should be reachable", timeout: 20_000 },
      )
      .toBe(true);

    // All three doors are offered, including the one that used to loop.
    await expect(page.getByRole("link", { name: /view my employment journey map/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );

    // Step 3 — the recommended path choice routes to the Sage conversation.
    await page.getByRole("link", { name: /discover my career path/i }).click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 20_000 });
    await expect(page.getByLabel("Message to Sage")).toBeVisible({ timeout: 20_000 });

    // Choosing a path recorded that this student finished the intro, and that
    // fact is what closes the loop: the dashboard keeps them (it would have
    // bounced a student with no goals and no conversation straight back)...
    // Wait for real dashboard content before judging the URL: this page group
    // streams, so a redirect arrives AFTER the shell — a URL checked too early
    // would read /dashboard even on a bounce. (The journey strip renders the
    // CTA twice, one variant per breakpoint; exactly one is ever visible.)
    await page.goto("/dashboard");
    await expect(
      page.getByTestId("current-target-cta").filter({ visible: true }),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // ...and the intro is not replayed at them.
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
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
