import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { E2E_CLASS, E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";
import { createPrisma } from "./helpers/db";

/**
 * The teacher's core loop, measured:
 *
 *   the intervention queue → the student at the top of it → one recorded
 *   action → back to the queue
 *
 * `e2e/teacher-loop.spec.ts` already asserts the surfaces are REACHABLE. This
 * spec asks what the loop costs, and writes the answer to
 * reports/benchmarks/raw/journey-teacher-loop.json for
 * scripts/bench/suites/journey-teacher-loop.mjs to score. Collector and scorer
 * are split so Playwright stays out of the benchmark runner (the shape
 * e2e/bench-connect-journey.spec.ts established).
 *
 * WHY A CASE NOTE AND NOT A VERIFICATION. Confirming the seeded pending
 * orientation claim is the other candidate action, and it is a better story —
 * but it consumes the fixture: the second run finds nothing pending and the
 * measurement silently becomes a different, shorter loop. A case note is a real
 * recorded action (POST /api/teacher/students/[id]/notes, audit-logged) that
 * can be taken again tomorrow, so this number stays comparable across runs.
 *
 * The queue is scoped to the fixture class, as teacher-loop.spec.ts does, so
 * the loop is deterministic on a shared database.
 *
 * Requires the fixture seed (idempotent):
 *   npx tsx scripts/seed-e2e-users.ts
 */

const REPORT_PATH =
  process.env.BENCH_TEACHER_LOOP_REPORT ??
  path.join(process.cwd(), "reports", "benchmarks", "raw", "journey-teacher-loop.json");

const STEP_KEYS = ["queue", "open_student", "record_action", "return_to_queue"] as const;
type StepKey = (typeof STEP_KEYS)[number];

test("Teacher loop: queue → student → one recorded action → back to the queue", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const prisma = createPrisma();
  const started = Date.now();
  const steps: { key: StepKey; seconds: number }[] = [];
  /** Controls the TEACHER presses, including the navigations they make. */
  let teacherTaps = 0;
  /** From opening the queue to the action being recorded. */
  let queueToActionMs = 0;

  async function step(key: StepKey, act: () => Promise<void>) {
    const at = Date.now();
    await act();
    steps.push({ key, seconds: Number(((Date.now() - at) / 1000).toFixed(2)) });
  }

  const context = await loginContext(browser, E2E_TEACHER);

  try {
    const page = await context.newPage();

    // The fixture class id, via the same API the class switcher uses.
    const classesResponse = await context.request.get("/api/teacher/classes");
    expect(classesResponse.ok(), "could not list the teacher's classes").toBe(true);
    const { classes } = (await classesResponse.json()) as {
      classes: { id: string; code: string }[];
    };
    const fixtureClass = classes.find((entry) => entry.code === E2E_CLASS.code);
    if (!fixtureClass) {
      throw new Error(`Class ${E2E_CLASS.code} not found — run scripts/seed-e2e-users.ts`);
    }

    const seededStudent = await prisma.student.findUnique({
      where: { studentId: E2E_STUDENT.login },
      select: { id: true },
    });
    expect(seededStudent, `${E2E_STUDENT.login} is missing — run seed-e2e-users.ts`).toBeTruthy();

    const notesBefore = await prisma.caseNote.count({
      where: { studentId: seededStudent!.id },
    });

    const queueOpenedAt = Date.now();

    // ── 1. The queue ─────────────────────────────────────────────────────
    //
    // Scoped to the "Needs attention" panel: the roster and the class overview
    // also link the student, and the loop being measured starts at the queue.
    const queuePanel = page
      .locator("section")
      .filter({ hasText: "Needs attention" })
      .first();
    const studentLink = queuePanel
      .getByRole("link", { name: new RegExp(E2E_STUDENT.displayName, "iu") })
      .first();

    await step("queue", async () => {
      await page.goto(`/teacher?classId=${fixtureClass.id}`);
      teacherTaps += 1;
      await expect(
        page.getByRole("heading", { name: /intervention queue/iu }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        studentLink,
        "the seeded student should be in the queue — run seed-e2e-users.ts",
      ).toBeVisible({ timeout: 30_000 });
    });

    // ── 2. Open the student from the queue ───────────────────────────────
    await step("open_student", async () => {
      await studentLink.click();
      teacherTaps += 1;
      await page.waitForURL(new RegExp(`/teacher/students/${seededStudent!.id}`, "u"), {
        timeout: 30_000,
      });
      // The tab bar is the loaded-state marker; Coach is the default tab, and
      // Case Notes lives in its OperationsTab render (scope="coaching"), so
      // no tab tap is needed and none is counted.
      await expect(page.getByRole("button", { name: "Coach" })).toBeVisible({ timeout: 30_000 });
    });

    // ── 3. One recorded action ───────────────────────────────────────────
    await step("record_action", async () => {
      const noteBody = page.getByPlaceholder(/what happened, what matters/iu);
      await expect(noteBody).toBeVisible({ timeout: 30_000 });
      await noteBody.click();
      teacherTaps += 1;
      await noteBody.fill("Checked in about the pending orientation item.");
      await page.getByRole("button", { name: /^add note$/iu }).click();
      teacherTaps += 1;
      await expect(page.getByText("Case note saved.")).toBeVisible({ timeout: 30_000 });
      queueToActionMs = Date.now() - queueOpenedAt;
    });

    // The action reached the database, not just the screen.
    await expect
      .poll(
        () => prisma.caseNote.count({ where: { studentId: seededStudent!.id } }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(notesBefore);

    // ── 4. Back to the queue ─────────────────────────────────────────────
    //
    // The loop is only a loop if it closes: an instructor who has to rebuild
    // their place in the queue after every action is doing a different job.
    await step("return_to_queue", async () => {
      await page.goto(`/teacher?classId=${fixtureClass.id}`);
      teacherTaps += 1;
      await expect(
        page.getByRole("heading", { name: /intervention queue/iu }).first(),
      ).toBeVisible({ timeout: 30_000 });
    });

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
          teacherTaps,
          queueToActionSeconds: Number((queueToActionMs / 1000).toFixed(2)),
          totalSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
          stepCount: STEP_KEYS.length,
          steps,
          action: "case_note",
          measuredAt: new Date().toISOString(),
          note:
            "teacherTaps counts controls the instructor presses, including the two " +
            "navigations they make themselves; typing is not a tap. The recorded " +
            "action is a case note rather than an orientation verification, because " +
            "verifying consumes the fixture and the next run would measure a " +
            "shorter loop without saying so.",
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
