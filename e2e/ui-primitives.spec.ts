import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { join } from "node:path";

/**
 * E2E: the shared HIG primitives behave correctly in a real browser.
 *
 * useConfirm's prompt mode, useUndo's toast, and FormDialog replace the
 * browser's native dialogs and backdrop-dismissed modals (HIG review D-24,
 * D-27, B-32, C-47). Their markup is unit-tested; this proves the parts only a
 * browser has: showModal(), Escape, backdrop taps, nested dialogs, and timers.
 * The harness is bundled with esbuild and served by page.route, so no app
 * server or login is involved.
 */

const ORIGIN = "https://ui-harness.test";
let bundle = "";

test.beforeAll(async () => {
  const root = process.cwd();
  const result = await build({
    entryPoints: [join(root, "e2e/harness/ui-primitives.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0].text;
});

async function openHarness(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith(".js") ? "text/javascript" : "text/html",
      body: route.request().url().endsWith(".js") ? bundle : '<!doctype html><div id="root"></div><script src="/app.js"></script>',
    }),
  );
  await page.goto(`${ORIGIN}/`);
}

test.describe("useConfirm prompt", () => {
  test("returns the trimmed note when confirmed", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-prompt");
    const dialog = page.getByRole("alertdialog", { name: "Return this form?" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Note for the student (optional)").fill("  fix page 2  ");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(page.locator("#prompt-result")).toHaveText("text:fix page 2");
    await expect(dialog).toBeHidden();
  });

  test("returns null on Escape", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-prompt");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#prompt-result")).toHaveText("null");
  });
});

test.describe("useUndo", () => {
  test("Undo restores the item and never commits", async ({ page }) => {
    await page.clock.install();
    await openHarness(page);
    await page.click("#remove-pin");
    await expect(page.locator("#pin")).toBeHidden();
    // <output> elements also have role=status, so target the toast's live region.
    await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText("Pin removed.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#pin")).toBeVisible();
    await page.clock.runFor(10_000);
    await expect(page.locator("#commits")).toHaveText("0");
  });

  test("commits once the undo window closes", async ({ page }) => {
    await page.clock.install();
    await openHarness(page);
    await page.click("#remove-pin");
    await expect(page.locator("#commits")).toHaveText("0");
    await page.clock.runFor(6_500);
    await expect(page.locator("#commits")).toHaveText("1");
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });
});

test.describe("FormDialog", () => {
  test("Escape closes a clean form", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await expect(page.getByRole("dialog", { name: "Quick task for Sam" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#form-state")).toHaveText("closed");
  });

  test("a dirty form asks before discarding, and Keep editing keeps it", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await page.getByLabel("What needs to be done?").fill("Call about the GED test");
    await page.keyboard.press("Escape");
    const ask = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.locator("#form-state")).toHaveText("open");
    await expect(page.getByLabel("What needs to be done?")).toHaveValue("Call about the GED test");

    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("#form-state")).toHaveText("closed");
  });

  test("a backdrop tap on a dirty form asks too", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await page.getByLabel("What needs to be done?").fill("Call about the GED test");
    await page.mouse.click(5, 5);
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toBeVisible();
    await expect(page.locator("#form-state")).toHaveText("open");
  });
});
