import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E2E: the goals roadmap keeps its controls tappable at every width.
 *
 * Growing read-aloud to 44pt (HIG Phase 2) widened the right-hand column of
 * each monthly card until it covered Edit and Remove: at 320 every tap on
 * them read the goal aloud or opened Ask Sage. At tablet widths the two-column
 * roadmap left the inline edit field 18px wide. Measured by the g02 reviewer
 * and fixed by letting the title column wrap and by holding the roadmap to one
 * column below xl. This spec renders the real component with the real
 * stylesheet and checks both, without the app server.
 */

const ORIGIN = "https://goals-harness.test";
let bundle = "";
let styles = "";

test.beforeAll(async () => {
  const root = process.cwd();
  const result = await build({
    entryPoints: [join(root, "e2e/harness/goals-layout.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0].text;
  const cssPath = join(root, "src/app/globals.css");
  styles = (await postcss([tailwind({ base: root })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
});

// Same shell classes as the student layout, so the cards get the same width.
const SHELL = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head>
<body><main class="app-main min-h-screen pb-28 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"><div class="page-shell space-y-6">
<div id="root"></div></div></main><script src="/app.js"></script></body></html>`;

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.endsWith(".css")) return route.fulfill({ contentType: "text/css", body: styles });
    return route.fulfill({ contentType: "text/html", body: SHELL });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('[aria-label="Edit Monthly"]');
}

/** For each monthly card, what a tap at the centre of Edit and of Remove actually hits. */
async function tapTargets(page: Page): Promise<Array<{ edit: string; remove: string }>> {
  return page.evaluate(() => {
    const hit = (el: Element) => {
      // globals.css sets scroll-behavior: smooth; measure after an instant scroll.
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const box = el.getBoundingClientRect();
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return target?.closest("button") === el ? "self" : (target?.closest("button")?.getAttribute("aria-label") ?? target?.tagName ?? "none");
    };
    return [...document.querySelectorAll('[aria-label="Edit Monthly"]')].map((edit) => {
      const card = edit.closest("article") ?? document.body;
      const remove = card.querySelector('[aria-label="Remove Monthly"]');
      return { edit: hit(edit), remove: remove ? hit(remove) : "missing" };
    });
  });
}

for (const width of [320, 375, 390, 768, 1024, 1280]) {
  test(`Edit and Remove are not covered at ${width}px`, async ({ page }) => {
    await open(page, width);
    const targets = await tapTargets(page);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toEqual(targets.map(() => ({ edit: "self", remove: "self" })));
  });
}

for (const width of [768, 834]) {
  test(`the inline monthly edit field is usable at ${width}px`, async ({ page }) => {
    await open(page, width);
    await page.locator('[aria-label="Edit Monthly"]').first().click();
    const field = page.locator('input[aria-label="Monthly goal"]').first();
    await expect(field).toBeVisible();
    const box = await field.boundingBox();
    expect(box?.width ?? 0, "a student must be able to see what they type").toBeGreaterThan(150);
  });
}
