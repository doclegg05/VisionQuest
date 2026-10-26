import { test, expect } from "@playwright/test";
import { E2E_CLASS, E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * E2E: the teacher home has one intervention queue (issue #39). The class
 * overview keeps appointments and the roster, and every control on a queue
 * row is a 44px touch target at phone width.
 *
 * Requires the fixture seed: npx tsx scripts/seed-e2e-users.ts
 */
test("teacher home shows one queue, keeps appointments and the roster, with 44px controls at 375px", async ({ browser }) => {
  const context = await loginContext(browser, E2E_TEACHER);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });

    const classesResponse = await context.request.get("/api/teacher/classes");
    expect(classesResponse.ok()).toBe(true);
    const { classes } = (await classesResponse.json()) as { classes: Array<{ id: string; code: string }> };
    const fixtureClass = classes.find((item) => item.code === E2E_CLASS.code);
    if (!fixtureClass) throw new Error(`fixture class ${E2E_CLASS.code} not found`);

    await page.goto(`/teacher?classId=${fixtureClass.id}`);

    await expect(page.getByRole("heading", { name: /intervention queue/i })).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Upcoming appointments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All Students" })).toBeVisible();

    const queuePanel = page.locator("section").filter({ hasText: "Needs attention" }).first();
    const row = queuePanel
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: new RegExp(E2E_STUDENT.displayName, "i") }) })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const controls = row.locator("a, button");
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await controls.nth(index).boundingBox();
      if (!box) throw new Error(`queue row control ${index} has no box`);
      expect(box.height, `control ${index} height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `control ${index} width`).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
});
