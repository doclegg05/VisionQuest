import { test, expect } from "@playwright/test";
import { E2E_CLASS, E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * E2E: the core teacher loop — intervention queue → student detail →
 * verification surface.
 *
 * Requires the fixture seed (idempotent — reruns are safe):
 *
 *   npx tsx scripts/seed-e2e-users.ts
 *
 * The seeded student is guaranteed queue-worthy: incomplete orientation
 * contributes urgency, and one orientation item sits in "pending teacher
 * verification" — the exact surface this loop must reach. The dashboard is
 * scoped to the fixture class (?classId=) so the flow stays deterministic
 * on shared databases.
 */

test("teacher works the loop: queue → student detail → anchors → verification surface", async ({ browser }) => {
  const context = await loginContext(browser, E2E_TEACHER);
  try {
    const page = await context.newPage();

    // Resolve the fixture class id via the same API the class switcher uses.
    const classesResponse = await context.request.get("/api/teacher/classes");
    expect(classesResponse.ok()).toBe(true);
    const { classes } = (await classesResponse.json()) as {
      classes: Array<{ id: string; code: string }>;
    };
    const fixtureClass = classes.find((c) => c.code === E2E_CLASS.code);
    if (!fixtureClass) {
      throw new Error(
        `Class ${E2E_CLASS.code} not found — run scripts/seed-e2e-users.ts`,
      );
    }

    // The queue API must flag the seeded student (urgency > 0) and carry
    // their internal DB id for the deep link.
    const queueResponse = await context.request.get(
      `/api/teacher/intervention-queue?classId=${fixtureClass.id}`,
    );
    expect(queueResponse.ok()).toBe(true);
    const { queue } = (await queueResponse.json()) as {
      queue: Array<{ studentId: string; publicStudentId: string; urgencyScore: number }>;
    };
    const seeded = queue.find((entry) => entry.publicStudentId === E2E_STUDENT.login);
    expect(seeded, `${E2E_STUDENT.login} should be in the intervention queue`).toBeTruthy();
    expect(seeded!.urgencyScore).toBeGreaterThan(0);
    const studentDbId = seeded!.studentId;

    // 1. Teacher dashboard renders the intervention queue with the student.
    await page.goto(`/teacher?classId=${fixtureClass.id}`);
    // Two queue surfaces render an "Intervention Queue" heading (the
    // dashboard panel and the class-overview variant) — either proves the
    // queue rendered.
    await expect(
      page.getByRole("heading", { name: /intervention queue/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
    // Scope to the queue panel (eyebrow "Needs attention") — other dashboard
    // surfaces (roster, class overview) also link the student, by public id.
    const queuePanel = page
      .locator("section")
      .filter({ hasText: "Needs attention" })
      .first();
    const studentLink = queuePanel
      .getByRole("link", { name: new RegExp(E2E_STUDENT.displayName, "i") })
      .first();
    await expect(studentLink).toBeVisible({ timeout: 20_000 });

    // 2. Open the student from the queue.
    await studentLink.click();
    await page.waitForURL(new RegExp(`/teacher/students/${studentDbId}`), {
      timeout: 20_000,
    });
    // Detail loads client-side; the tab bar is the loaded-state marker.
    await expect(page.getByRole("button", { name: "Coach" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Admin" })).toBeVisible();

    // 3. Deep-link anchors switch tabs (useAnchorTabSwitch): only the active
    // tab's content is in the DOM, so the target becoming visible proves the
    // anchor→tab switch worked.
    await page.goto(`/teacher/students/${studentDbId}#orientation-review`);
    await expect(page.locator("#orientation-review")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: /orientation \(\d+\/\d+\)/i }),
    ).toBeVisible();

    // 4. The verification surface is reachable and live: the seeded pending
    // orientation claim shows the verify affordances.
    await expect(page.getByText(/student marked done/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" }).first()).toBeVisible();

    // A second anchor on a different tab (admin), same navigation path
    // teachers hit from queue action links.
    //
    // KNOWN GAP (finding, verified 2026-08-19): #follow-up-tasks is NOT used
    // here because it is a dead deep link today — the anchor map sends it to
    // the "admin" tab, but since the Phase 6 tab reorg the Follow-Up Tasks
    // card renders only under OperationsTab scope="coaching" (the Coach
    // tab), so the queue's "Add task" fallback action
    // (`#follow-up-tasks`, src/lib/teacher/intervention-queue.ts) lands on
    // the Admin tab with no such section. The map-integrity unit test misses
    // it because it only checks the id exists somewhere in the sources, not
    // on the mapped tab. Fix belongs to a later phase; #submitted-forms is a
    // healthy admin-tab anchor.
    await page.goto(`/teacher/students/${studentDbId}#submitted-forms`);
    await expect(page.locator("#submitted-forms")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#submitted-forms")).toContainText(/submitted forms/i);
  } finally {
    await context.close();
  }
});
