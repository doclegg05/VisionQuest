import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { E2E_JOURNEY_STUDENT } from "./fixtures";
import { createPrisma, resetStudentToDayOne } from "./helpers/db";

/**
 * A student's first session, at 375 px, measured.
 *
 *   sign in → welcome → meet Sage → first orientation win → path choice →
 *   first message to Sage → the dashboard's next step → first saved goal
 *
 * `e2e/student-journey.spec.ts` already asserts this path WORKS. This spec
 * asks a different question — what it COSTS — and writes the answer to
 * reports/benchmarks/raw/journey-day1.json for
 * scripts/bench/suites/journey-day1.mjs to score. Splitting the collector from
 * the scorer keeps Playwright out of the benchmark runner, which starts plain
 * Node (same shape as e2e/bench-connect-journey.spec.ts).
 *
 * Three numbers, and the third is the one worth arguing about:
 *
 *   studentTaps          controls the student must press, end to end.
 *   totalSeconds         wall clock, informational — it includes the app's own
 *                        network and the runner's waits.
 *   stepsWithNextSignal  steps where the page told the student what to do next
 *                        BEFORE they had to work it out. That is the charter's
 *                        "one next signal" promise, and it is the only one of
 *                        the three that is a product claim rather than a cost.
 *
 * SAGE IS STUBBED AT THE ROUTE, not skipped. The step being measured is the
 * student sending their first message and seeing an answer come back; the
 * model's words are not part of that cost, and CI has no key (nor should this
 * gate spend one). `page.route` returns a valid SSE body, so everything from
 * the composer to the rendered reply is the real client.
 *
 * Requires the fixture seed (idempotent):
 *   npx tsx scripts/seed-e2e-users.ts
 */

const REPORT_PATH =
  process.env.BENCH_JOURNEY_DAY1_REPORT ??
  path.join(process.cwd(), "reports", "benchmarks", "raw", "journey-day1.json");

/**
 * Ceiling on any single tap or field entry.
 *
 * Playwright's default action timeout is UNLIMITED, which is the wrong
 * default for a collector: one missing button silently consumes the entire
 * test budget and the report says "Test timeout exceeded" with no step named.
 * Generous enough that a slow CI runner never trips it, short enough that
 * eight of them cannot outlast the 180 s test timeout — so the failure that
 * surfaces is the step's, not the suite's.
 */
const ACTION_TIMEOUT_MS = 20_000;

/** The eight steps, in order. Their keys are what the report and scorer share. */
const STEP_KEYS = [
  "sign_in",
  "welcome",
  "meet_sage",
  "first_orientation_win",
  "path_choice",
  "first_sage_message",
  "dashboard_next_step",
  "first_goal",
] as const;

type StepKey = (typeof STEP_KEYS)[number];

interface StepRecord {
  key: StepKey;
  seconds: number;
  /** Was the "do this next" affordance on screen before the student acted? */
  nextSignal: boolean;
}

/**
 * A stubbed Sage reply, in the wire format `parseChatSseChunk` reads:
 * `data: <json>` blocks separated by a blank line.
 */
const SAGE_REPLY = "Good to meet you. Let us find one thing to do today.";
const SAGE_SSE = [
  'data: {"conversationId":"bench-journey-day1"}',
  "",
  `data: ${JSON.stringify({ text: SAGE_REPLY })}`,
  "",
  'data: {"done":true,"conversationId":"bench-journey-day1"}',
  "",
  "",
].join("\n");

test("Day-1 journey: sign in → welcome → first win → Sage → first goal, at 375px", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const prisma = createPrisma();
  const started = Date.now();
  const steps: StepRecord[] = [];
  /** Controls the STUDENT presses. Typing is not a tap; pressing is. */
  let studentTaps = 0;

  /** Time one step, recording whether its next-step affordance was present. */
  async function step(key: StepKey, nextSignal: () => Promise<boolean>, act: () => Promise<void>) {
    const at = Date.now();
    const signal = await nextSignal();
    // Name the step in the failure. Playwright's default action timeout is
    // unlimited, so a single affordance that never arrives used to burn the
    // whole 180 s test budget and report only "Test timeout exceeded" — three
    // minutes of CI, and nothing saying WHICH of the eight steps stalled. A
    // collector whose failures are undiagnosable is not much better than one
    // that does not run, so every action is bounded (see ACTION_TIMEOUT_MS)
    // and its step key is attached on the way out.
    try {
      await act();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `day-1 journey stalled at step "${key}" (next-step affordance ` +
          `${signal ? "was" : "was NOT"} on screen): ${detail}`,
      );
    }
    steps.push({ key, seconds: Number(((Date.now() - at) / 1000).toFixed(2)), nextSignal: signal });
  }

  /** True when the locator becomes visible inside the timeout, false otherwise. */
  async function visible(page: Page, locator: ReturnType<Page["getByRole"]>): Promise<boolean> {
    return locator
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }

  const context = await browser.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    viewport: { width: 375, height: 812 },
  });

  try {
    // True day-1 state before the browser touches anything, so this is the
    // student's real first session and not a replay of the last run's.
    const student = await prisma.student.findUnique({
      where: { studentId: E2E_JOURNEY_STUDENT.login },
      select: { id: true },
    });
    expect(student, `${E2E_JOURNEY_STUDENT.login} is missing — run seed-e2e-users.ts`).toBeTruthy();
    await resetStudentToDayOne(prisma, student!.id);

    const page = await context.newPage();

    // The model never runs. Everything from the composer to the rendered
    // reply is the real client reading a real SSE stream.
    await page.route("**/api/chat/send", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        body: SAGE_SSE,
      });
    });

    // ── 1. Sign in ───────────────────────────────────────────────────────
    //
    // The real form, not the API: this is the student's actual first screen,
    // and its button is the landing page's own next-step signal.
    await page.goto("/");
    const signIn = page.getByRole("button", { name: /sign in to see what to do today/i });
    await step(
      "sign_in",
      () => visible(page, signIn),
      async () => {
        await page.getByLabel(/username or email/i).fill(E2E_JOURNEY_STUDENT.login, { timeout: ACTION_TIMEOUT_MS });
        await page.getByLabel(/password/i).fill(E2E_JOURNEY_STUDENT.password, { timeout: ACTION_TIMEOUT_MS });
        await signIn.first().click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
        await page.waitForURL(/\/welcome/u, { timeout: 30_000 });
        // Wait for the welcome flow to HYDRATE, not merely to render. The
        // "Let's get started" button is server-rendered, so Playwright's
        // actionability checks pass while its React onClick is still
        // unattached — the tap then lands on nothing, the flow never advances,
        // and the next step waits out the whole test budget on a page that
        // looks correct in the failure screenshot. Observed exactly once in a
        // six-collector run, which is the frequency that makes it worth a
        // wait rather than a retry: retrying the tap would inflate
        // studentTaps, and this suite's whole point is counting taps honestly.
        await page.waitForLoadState("networkidle");
      },
    );

    // ── 2. Welcome ───────────────────────────────────────────────────────
    const getStarted = page.getByRole("button", { name: /let's get started/i });
    await step(
      "welcome",
      () => visible(page, getStarted),
      async () => {
        await getStarted.click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
      },
    );

    // ── 3. Meet Sage ─────────────────────────────────────────────────────
    const next = page.getByRole("button", { name: /^next/i });
    await step(
      "meet_sage",
      () => visible(page, next),
      async () => {
        await next.first().click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
      },
    );

    // ── 4. The first orientation win ─────────────────────────────────────
    //
    // Journey step 0. Completing it writes a real OrientationProgress row
    // through POST /api/orientation — this is not a walkthrough click.
    const readThis = page.getByRole("button", { name: /i've read this/i });
    await step(
      "first_orientation_win",
      () => visible(page, readThis),
      async () => {
        await readThis.first().click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
      },
    );

    // ── 5. The path choice ───────────────────────────────────────────────
    //
    // Two legitimate continuations: completing the ONLY quick win plays the
    // score card and auto-advances after a timer; with more remaining, "Skip
    // for now" advances manually. Polled rather than branched on one snapshot,
    // which races the auto-advance (student-journey.spec.ts has the same note).
    const pathHeading = page.getByRole("heading", { name: /your path to employment/i });
    const skip = page.getByRole("button", { name: /skip for now/i });
    const discover = page.getByRole("link", { name: /discover my career path/i });

    await step(
      "path_choice",
      async () => {
        await expect
          .poll(
            async () => {
              if (await pathHeading.isVisible()) return true;
              if (await skip.isVisible()) {
                const clicked = await skip
                  .click({ timeout: 2_000 })
                  .then(() => true)
                  .catch(() => false);
                if (clicked) studentTaps += 1;
              }
              return pathHeading.isVisible();
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        return visible(page, discover);
      },
      async () => {
        await discover.click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
        await page.waitForURL(/\/chat/u, { timeout: 30_000 });
      },
    );

    // ── 6. The first message to Sage ─────────────────────────────────────
    const composer = page.getByLabel("Message to Sage");
    const send = page.getByRole("button", { name: "Send message" });
    await step(
      "first_sage_message",
      () => visible(page, composer),
      async () => {
        await composer.click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
        await composer.fill("I want to find work near me.", { timeout: ACTION_TIMEOUT_MS });
        await send.click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
        await expect(page.getByText(SAGE_REPLY)).toBeVisible({ timeout: 30_000 });
      },
    );

    // ── 7. The dashboard's one next step ─────────────────────────────────
    //
    // The charter's "one next signal": after the intro, the dashboard must
    // tell the student what to do without them working it out. Filtered to
    // visible because the card renders in both the full and compact variants.
    const cta = page.getByTestId("current-target-cta").filter({ visible: true }).first();
    await step(
      "dashboard_next_step",
      async () => {
        await page.goto("/dashboard");
        studentTaps += 1;
        const shown = await cta
          .waitFor({ state: "visible", timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        if (!shown) return false;
        // A CTA with no words is not a next signal.
        return (await cta.innerText()).trim().length > 0;
      },
      async () => {
        // Nothing to press here: the signal IS the step.
      },
    );

    // ── 8. The first saved goal ──────────────────────────────────────────
    await page.goto("/goals");
    studentTaps += 1;
    const defineVision = page.getByRole("button", { name: /define your big vision/i });
    const goalText = "Become a certified welder";
    await step(
      "first_goal",
      () => visible(page, defineVision),
      async () => {
        await defineVision.click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
        await page.getByPlaceholder(/ultimate dream career/i).fill(goalText, { timeout: ACTION_TIMEOUT_MS });
        await page.getByRole("button", { name: /^add$/i }).click({ timeout: ACTION_TIMEOUT_MS });
        studentTaps += 1;
        await expect(page.getByText(goalText).first()).toBeVisible({ timeout: 30_000 });
      },
    );

    // The goal reached the database, not just the screen.
    await expect
      .poll(
        () => prisma.goal.count({ where: { studentId: student!.id, level: "bhag" } }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // ── The measurement ──────────────────────────────────────────────────
    //
    // No student identifiers and no free text: the scorer's output is a
    // committed result file.
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify(
        {
          completed: 1,
          studentTaps,
          totalSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
          stepCount: STEP_KEYS.length,
          stepsWithNextSignal: steps.filter((entry) => entry.nextSignal).length,
          steps,
          viewport: "375x812",
          sageStubbed: true,
          measuredAt: new Date().toISOString(),
          note:
            "studentTaps counts controls the student presses, including the two " +
            "navigations they make themselves; typing is not a tap. Sage is stubbed " +
            "at POST /api/chat/send — the step being measured is sending a first " +
            "message and seeing an answer, not what the model said.",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await context.close();
    await prisma.$disconnect();
  }
});
