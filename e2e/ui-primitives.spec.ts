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
  // <output> elements also have role=status, so target the notice's live region.
  const notice = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

  test("focus moves to Undo when the removed row took it, and Undo restores with focus back", async ({ page }) => {
    await openHarness(page);
    await page.focus("#remove-pin");
    await page.keyboard.press("Enter");
    await expect(page.locator("#pin")).toBeHidden();
    await expect(notice(page)).toContainText("Pin removed.");
    await expect(page.getByRole("button", { name: "Undo" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#pin")).toBeVisible();
    await expect(notice(page)).toContainText("Pin restored.");
    await expect(page.locator("#remove-pin")).toBeFocused();
    await expect(page.locator("#commits")).toHaveText("0");
  });

  test("Undo stays available however long the person takes", async ({ page }) => {
    await page.clock.install();
    await openHarness(page);
    await page.click("#remove-pin");
    await page.clock.runFor(60_000);
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.locator("#commits")).toHaveText("0");
  });

  test("Dismiss sends the removal once", async ({ page }) => {
    await openHarness(page);
    await page.click("#remove-pin");
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator("#commits")).toHaveText("1");
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });

  test("hiding the tab sends the removal, since a hidden tab may be discarded", async ({ page }) => {
    await openHarness(page);
    await page.click("#remove-pin");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("#commits")).toHaveText("1");
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

  test("a dirty form asks before discarding, and Cancel keeps it", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await page.getByLabel("What needs to be done?").fill("Call about the GED test");
    await page.keyboard.press("Escape");
    const ask = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#form-state")).toHaveText("open");
    await expect(page.getByLabel("What needs to be done?")).toHaveValue("Call about the GED test");

    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("#form-state")).toHaveText("closed");
  });

  test("Escape on the discard question returns to the form with the text kept", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await page.getByLabel("What needs to be done?").fill("abc");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toBeVisible();
    // The nested <dialog>'s cancel bubbles through React to FormDialog's onCancel,
    // which used to reopen the question instead of returning to the form.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toBeHidden();
    await expect(page.locator("#form-state")).toHaveText("open");
    await expect(page.getByLabel("What needs to be done?")).toHaveValue("abc");
  });

  test("typed text survives any number of Escapes, and the page never locks", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await page.getByLabel("What needs to be done?").fill("abc");
    // Escape is not user activation, so Chromium's close watcher eventually
    // force-closes the dialog without a cancelable event. A dirty form must
    // come back and ask instead of losing what was typed.
    for (let i = 0; i < 8; i++) await page.keyboard.press("Escape");
    const ask = page.getByRole("alertdialog", { name: "Discard changes?" });
    if (await ask.isVisible()) await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#form-state")).toHaveText("open");
    await expect(page.getByRole("dialog", { name: "Quick task for Sam" })).toBeVisible();
    await expect(page.getByLabel("What needs to be done?")).toHaveValue("abc");
    await page.getByLabel("What needs to be done?").fill("abc still usable");
  });

  test("focus returns to the opener after Escape and after Save", async ({ page }) => {
    // Opened from the keyboard: Safari does not focus a button on mouse click,
    // and keyboard users are the ones a lost focus position strands.
    await openHarness(page);
    await page.focus("#open-form");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Quick task for Sam" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#form-state")).toHaveText("closed");
    await expect(page.locator("#open-form")).toBeFocused();

    await page.focus("#open-form");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Save task" }).click();
    await expect(page.locator("#form-state")).toHaveText("closed");
    await expect(page.locator("#open-form")).toBeFocused();
  });

  test("a text selection that ends on the backdrop does not close the form", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    const heading = await page.getByRole("heading", { name: "Quick task for Sam" }).boundingBox();
    if (!heading) throw new Error("heading not found");
    await page.mouse.move(heading.x + 4, heading.y + heading.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator("#form-state")).toHaveText("open");
  });

  test("the first field has focus when the dialog opens", async ({ page }) => {
    await openHarness(page);
    await page.click("#open-form");
    await expect(page.getByLabel("What needs to be done?")).toBeFocused();
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
