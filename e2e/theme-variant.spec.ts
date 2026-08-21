import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { E2E_STUDENT } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * E2E: the `dark:` variant follows the app's theme, not the OS setting.
 *
 * VisionQuest themes with `data-theme` on <html> (cookie-driven, resolved in
 * layout.tsx). Tailwind 4's stock `dark:` variant keys off the
 * `prefers-color-scheme` media query. While those were unwired, a student whose
 * OS disagreed with their in-app theme got half of every
 * `bg-x-50 dark:bg-x-950` pair — light surfaces on a dark page and vice versa.
 * That shipped white body text on a pale green card, a WCAG AA failure for an
 * audience this project holds to AA (found 2026-08-20).
 *
 * Both cases below force the OS scheme OPPOSITE to the app theme. That is the
 * combination that used to break, and the only one that can tell the two
 * mechanisms apart: with OS and app agreeing, a broken build still looks right.
 *
 * The probe element is injected rather than found on the page. Two reasons:
 * GoalsPageClient's `dark:`-bearing markup is data-dependent (BHAG present or
 * not), and its outer card carries `.surface-section`, whose unlayered
 * `border`/`background` beat any Tailwind utility. An injected node isolates
 * the one thing under test — whether `dark:` responds to the theme attribute.
 * The classes it uses are real ones from GoalsPageClient, so they are compiled
 * into the shipped stylesheet; nothing here asks Tailwind for a new utility.
 *
 * Requires the fixture seed: npx tsx scripts/seed-e2e-users.ts
 */

/** Real pair from GoalsPageClient's BHAG card, so both halves are compiled. */
const PROBE_CLASSES = "bg-white/80 dark:bg-black/20";

interface Probe {
  /** The raw computed value, for failure messages. */
  raw: string;
  /** Mean 0-255 channel after conversion. White ~255, black ~0. */
  brightness: number;
}

/**
 * Renders the probe under one theme and reports its background brightness.
 *
 * The channel values come from a 1x1 canvas rather than a regex over the
 * computed string: Chromium serializes these as `oklab(0.999994 … / 0.8)`,
 * whose leading numbers are 0-1 lightness/axis components, not 0-255 channels.
 * Parsing them as RGB scores white at 0.33 and silently passes a "is it dark?"
 * assertion — which is exactly how the first draft of this spec went green
 * against a broken build.
 */
async function probeBackground(
  page: Page,
  opts: { theme: "dark" | "light" },
): Promise<Probe> {
  return page.evaluate(
    ({ classes, theme }) => {
      document.documentElement.setAttribute("data-theme", theme);
      const el = document.createElement("div");
      el.id = "vq-theme-probe";
      el.className = classes;
      document.body.appendChild(el);
      const raw = getComputedStyle(el).backgroundColor;
      el.remove();

      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      // Composite over black so a translucent white still reads bright and a
      // translucent black stays dark — the two cases under test.
      ctx.fillStyle = raw;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);

      return { raw, brightness: (r + g + b) / 3 };
    },
    { classes: PROBE_CLASSES, theme: opts.theme },
  );
}

test.describe("dark: variant follows [data-theme], not the OS", () => {
  // Shares one signed-in context: /api/auth/login rate-limits per IP, and
  // concurrent logins from one IP contend on a single RateLimitEntry row.
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext | undefined;

  test.beforeAll(async ({ browser }) => {
    context = await loginContext(browser, E2E_STUDENT);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  function signedIn(): BrowserContext {
    if (!context) throw new Error("context missing — beforeAll login failed");
    return context;
  }

  async function goalsPage(osScheme: "dark" | "light"): Promise<Page> {
    const page = await signedIn().newPage();
    await page.emulateMedia({ colorScheme: osScheme });
    await page.goto("/goals");
    await page.waitForSelector("text=My Big Vision", { timeout: 30_000 });
    return page;
  }

  test("app dark + OS light applies the dark half of the pair", async () => {
    const page = await goalsPage("light");
    try {
      const bg = await probeBackground(page, { theme: "dark" });
      expect(
        bg.brightness,
        `app theme is dark, so dark:bg-black/20 must win over bg-white/80, got ${bg.raw}`,
      ).toBeLessThan(60);
    } finally {
      await page.close();
    }
  });

  test("app light + OS dark applies the light half of the pair", async () => {
    const page = await goalsPage("dark");
    try {
      const bg = await probeBackground(page, { theme: "light" });
      expect(
        bg.brightness,
        `app theme is light, so bg-white/80 must stand, got ${bg.raw}`,
      ).toBeGreaterThan(200);
    } finally {
      await page.close();
    }
  });

  test("toggling only data-theme flips the style, with the OS held fixed", async () => {
    const page = await goalsPage("light");
    try {
      const dark = await probeBackground(page, { theme: "dark" });
      const light = await probeBackground(page, { theme: "light" });

      expect(dark.raw, "the theme attribute alone must drive the style").not.toEqual(light.raw);
      expect(dark.brightness).toBeLessThan(light.brightness);
    } finally {
      await page.close();
    }
  });

  test("no dark: utility is compiled behind a prefers-color-scheme query", async () => {
    const page = await goalsPage("light");
    try {
      const strays = await page.evaluate(() => {
        const found: string[] = [];

        // Tailwind nests utilities inside @layer blocks, so a top-level-only
        // scan would find nothing and pass against a broken build.
        function walk(rules: CSSRuleList, underColorScheme: boolean) {
          for (const rule of Array.from(rules)) {
            const media =
              rule instanceof CSSMediaRule && rule.conditionText.includes("prefers-color-scheme");
            const inScheme = underColorScheme || media;

            const selector = (rule as CSSStyleRule).selectorText;
            if (inScheme && typeof selector === "string" && selector.includes(".dark\\:")) {
              found.push(selector);
            }

            const nested = (rule as unknown as { cssRules?: CSSRuleList }).cssRules;
            if (nested) walk(nested, inScheme);
          }
        }

        for (const sheet of Array.from(document.styleSheets)) {
          try {
            walk(sheet.cssRules, false);
          } catch {
            continue; // cross-origin sheet
          }
        }
        return found;
      });

      expect(
        strays,
        `these dark: utilities still key off the OS instead of [data-theme]: ${strays.join(", ")}`,
      ).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
