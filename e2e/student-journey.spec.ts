import { test, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
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
  // These tests share one signed-in context, which exists per worker — so
  // splitting them across workers would mean one login per worker, all firing
  // at once from one IP. That makes concurrent writes to the same
  // RateLimitEntry row, and Postgres answers the losers with a write-conflict
  // 500. Serial keeps the file on one worker and one login, which is also how
  // CI runs it (playwright.config.ts sets workers: 1 under CI).
  test.describe.configure({ mode: "serial" });

  let prisma: PrismaClient;
  let studentContext: BrowserContext | undefined;

  /**
   * One signed-in context for the established student, shared by every test
   * that needs them. /api/auth/login rate-limits to 10 attempts per IP per 15
   * minutes, so a login per test burns the budget across repeated local runs
   * and the whole file starts failing on HTTP 429 rather than on anything
   * real. Viewport is per-page, not per-context, so the 375px tests still get
   * a phone-sized page out of this same context.
   */
  test.beforeAll(async ({ browser }) => {
    prisma = createPrisma();
    studentContext = await loginContext(browser, E2E_STUDENT);
  });

  // Guarded: if beforeAll's login failed, teardown must not bury that real
  // error under a TypeError about an undefined context.
  test.afterAll(async () => {
    await studentContext?.close();
    await prisma?.$disconnect();
  });

  /** The shared signed-in context, or a clear error instead of `undefined`. */
  function signedIn(): BrowserContext {
    if (!studentContext) throw new Error("student context missing — beforeAll login failed");
    return studentContext;
  }

  /** A phone-sized page on the shared signed-in context. */
  async function phonePage() {
    const page = await signedIn().newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    return page;
  }

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
    // would read /dashboard even on a bounce.
    await page.goto("/dashboard");
    await expect(
      page.getByTestId("current-target-cta").filter({ visible: true }),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // ...and the intro is not replayed at them.
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });

  test("student with an active plan sees exactly one next-step card with an actionable CTA", async () => {
    const page = await signedIn().newPage();
    try {
      await page.goto("/dashboard");

      // No welcome redirect — this student has a confirmed goal.
      await expect(page).toHaveURL(/\/dashboard/);

      // Exactly one next-step badge. ("Current Target" was renamed to plain
      // language on 2026-08-20 — the invariant this pins is the count, not
      // the wording.)
      const nextStepBadge = page.getByText("Do this next", { exact: true });
      await expect(nextStepBadge).toHaveCount(1);
      await expect(nextStepBadge).toBeVisible();

      // ...with an actionable CTA. The journey engine puts orientation at
      // step 0, and the seeded student's orientation is deliberately kept
      // incomplete (one item pending teacher verification), so the one
      // next step must be orientation with its CTA pointing at /orientation.
      const cta = page.getByTestId("current-target-cta");
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute("href", "/orientation");
      await expect(cta).not.toHaveText(/^\s*$/);
    } finally {
      await page.close();
    }
  });

  /**
   * The 2026-08-20 mobile review: at 375px the eight-step strip wrapped into
   * four rows of mostly-locked circles, and the full card rendered on all five
   * student pages, so every page's own content began a viewport down.
   *
   * These assert the fix where the fix applies — a real 375px viewport — and
   * they fail if either half regresses: the strip coming back on phones, or
   * the full card returning to the four secondary pages.
   */
  test.describe("journey strip at 375px", () => {
    test("dashboard collapses the 8-step strip to a one-step summary", async () => {
      const page = await phonePage();
      try {
        await page.goto("/dashboard");

        // The summary replaces the strip — not both, not neither.
        const summary = page.getByTestId("journey-step-summary");
        await expect(summary).toBeVisible();
        await expect(summary).toContainText(/Step \d+ of \d+/);
        await expect(page.getByTestId("journey-steps")).toBeHidden();

        // The whole journey block must fit inside one phone screen's worth of
        // page. Measured in DOCUMENT coordinates on purpose: the chat-first
        // dashboard auto-scrolls to the composer, so viewport-relative y goes
        // negative here and a `y < 812` check would pass on an element that
        // had scrolled off the top — proving nothing.
        const journeyBottom = await page.evaluate(() => {
          const cta = document.querySelector('[data-testid="current-target-cta"]');
          if (!cta) return null;
          const rect = cta.getBoundingClientRect();
          return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, height: rect.height };
        });
        expect(journeyBottom, "the CTA should be laid out").toBeTruthy();
        expect(
          journeyBottom!.bottom,
          "the whole journey block must fit in one 812px screen (the 8-circle strip needed ~4 rows)",
        ).toBeLessThan(812);
        // Touch target: the review's floor is 44px.
        expect(journeyBottom!.height).toBeGreaterThanOrEqual(44);
      } finally {
        await page.close();
      }
    });

    test("the four secondary pages carry the one-line variant, not the full card", async () => {
      const page = await phonePage();
      try {
        for (const path of ["/goals", "/learning", "/portfolio", "/career"]) {
          await page.goto(path);

          const cta = page.getByTestId("current-target-cta");
          await expect(cta, `${path} should show the next step`).toBeVisible();
          await expect(cta, `${path} should name the next step`).toContainText(/Next:/);

          // The full card's parts must be absent here — that is the whole
          // point of the compact variant.
          await expect(page.getByText("Do this next", { exact: true })).toHaveCount(0);
          await expect(page.getByTestId("journey-step-summary")).toHaveCount(0);

          const box = await cta.boundingBox();
          expect(box, `${path}: the CTA should be laid out`).toBeTruthy();
          expect(box!.height, `${path}: 44px touch-target floor`).toBeGreaterThanOrEqual(44);
        }
      } finally {
        await page.close();
      }
    });
  });
});
