// e2e/spokes-visual.spec.ts
import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * Screenshot set for the SPOKES design review
 * (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md).
 * CI uploads OUT as the `spokes-visual` artifact, and
 * scripts/spokes-gallery.mjs turns two runs into a before/after page.
 * It asserts only that no page scrolls sideways.
 */
const OUT = "spokes-visual";
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const STUDENT_PAGES = [
  ["dashboard", "/dashboard"],
  ["goals", "/goals"],
  ["orientation", "/orientation"],
  ["portfolio", "/portfolio"],
  ["career", "/career"],
] as const;

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

async function setTheme(context: BrowserContext, theme: Theme): Promise<void> {
  const { origin } = new URL(test.info().project.use.baseURL ?? "http://localhost:3000");
  await context.addCookies([{ name: "vq-theme", value: theme, url: origin }]);
}

async function capture(
  page: Page,
  name: string,
  path: string,
  theme: Theme,
  ready?: (page: Page) => Promise<void>,
): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(path);
    if (ready) await ready(page);
    await page.waitForTimeout(1_500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `${name} (${theme}, ${viewport.name}px) scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-${viewport.name}.png`, fullPage: true });
  }
}

async function teacherDetailPath(context: BrowserContext): Promise<string> {
  const response = await context.request.get("/api/teacher/intervention-queue");
  expect(response.ok()).toBe(true);
  const body: { queue: Array<{ studentId: string; publicStudentId: string }> } = await response.json();
  const seeded = body.queue.find((entry) => entry.publicStudentId === E2E_STUDENT.login);
  if (!seeded) throw new Error(`${E2E_STUDENT.login} is not in the intervention queue; run scripts/seed-e2e-users.ts`);
  return `/teacher/students/${seeded.studentId}`;
}

async function withPage(context: BrowserContext, run: (page: Page) => Promise<void>): Promise<void> {
  try {
    const page = await context.newPage();
    await run(page);
  } finally {
    await context.close();
  }
}

test("sign-in page", async ({ browser }) => {
  for (const theme of THEMES) {
    const context = await browser.newContext();
    await setTheme(context, theme);
    await withPage(context, (page) => capture(page, "sign-in", "/", theme));
  }
});

test("sign-in error carries an icon", async ({ browser }) => {
  for (const theme of THEMES) {
    const context = await browser.newContext();
    await setTheme(context, theme);
    await withPage(context, async (page) => {
      await page.goto("/");
      await page.getByLabel(/username or email/i).fill("nonexistent-user");
      await page.getByLabel(/password/i).fill("wrongpassword");
      await page.getByRole("button", { name: /sign in to see what to do today/i }).click();
      const alert = page.getByRole("alert").first();
      await expect(alert).toBeVisible();
      // Dark-theme danger text is white (no SPOKES red passes on navy), so the icon carries "error".
      expect(await alert.locator("svg").count(), `${theme}: the error alert has no icon`).toBeGreaterThan(0);
      await page.screenshot({ path: `${OUT}/sign-in-error-${theme}.png` });
    });
  }
});

test("student pages", async ({ browser }) => {
  const context = await loginContext(browser, E2E_STUDENT);
  await withPage(context, async (page) => {
    for (const theme of THEMES) {
      await setTheme(context, theme);
      for (const [name, path] of STUDENT_PAGES) await capture(page, name, path, theme);
    }
  });
});

test("teacher pages", async ({ browser }) => {
  const context = await loginContext(browser, E2E_TEACHER);
  await withPage(context, async (page) => {
    const detail = await teacherDetailPath(context);
    for (const theme of THEMES) {
      await setTheme(context, theme);
      await capture(page, "teacher-queue", "/teacher", theme);
      await capture(page, "student-detail", detail, theme, (p) =>
        expect(p.getByRole("tablist", { name: "Student sections" })).toBeVisible({ timeout: 20_000 }),
      );
    }
  });
});
