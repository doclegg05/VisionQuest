import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E2E: removing a vision-board pin by keyboard keeps focus useful.
 *
 * After a removal, focus fell to <body> and Undo was the last tab stop; after
 * Undo nothing was announced and focus went nowhere (accessibility review,
 * HIG Phase 2). Focus now moves to Undo, and Undo puts it back on the restored
 * pin's own Remove button with "Pin restored." announced.
 */

const ORIGIN = "https://vision-board-harness.test";
let bundle = "";
let styles = "";

test.beforeAll(async () => {
  const root = process.cwd();
  const result = await build({
    entryPoints: [join(root, "e2e/harness/vision-board.tsx")],
    bundle: true, write: false, format: "iife", jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
    // Some imported modules read other env vars; give them an empty environment.
    banner: { js: 'var process = { env: { NODE_ENV: "production" } };' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0].text;
  const cssPath = join(root, "src/app/globals.css");
  styles = (await postcss([tailwind({ base: root })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
});

const SHELL = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head>
<body><main class="app-main min-h-screen pb-28 pt-20"><div class="page-shell"><div id="root"></div></div></main>
<script src="/app.js"></script></body></html>`;

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.endsWith(".css")) return route.fulfill({ contentType: "text/css", body: styles });
    return route.fulfill({ contentType: "text/html", body: SHELL });
  });
  await page.goto(`${ORIGIN}/`);
  await expect(page.getByText("Get my CDL by June").first()).toBeVisible();
}

test("removing a pin by keyboard: focus to Undo, then back to the restored pin", async ({ page }) => {
  await open(page);
  const remove = page.locator("button[aria-label^='Remove']:visible").first();
  const label = await remove.getAttribute("aria-label");
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Get my CDL by June")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByText("Get my CDL by June").first()).toBeVisible();
  await expect(page.locator('[role="status"][aria-live="polite"]').last()).toContainText("Pin restored.");
  await expect(page.locator(`button[aria-label="${label}"]:visible`).first()).toBeFocused();
});
