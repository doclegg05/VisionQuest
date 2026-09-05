import { test } from "@playwright/test";
import type { ElementHandle } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { E2E_STUDENT } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * Benchmark data collector: touch targets at 375x667 (student routes).
 *
 * Companion to config/benchmarks/touch-targets.json /
 * scripts/bench/suites/touch-targets.mjs (docs/superpowers/plans/
 * 2026-09-05-benchmark-suite.md, §4.9 "Touch targets"). This spec ONLY
 * collects raw data — it makes no pass/fail assertion of its own, matching
 * the pattern e2e/a11y-authenticated.spec.ts uses for its own soak lane: the
 * scorer module is the single place that applies the floor.
 *
 * Requires the fixture seed (idempotent — reruns are safe):
 *
 *   npx tsx scripts/seed-e2e-users.ts
 *
 * Walks the interactive-element rule from .claude/rules/ui-patterns.md
 * ("Touch targets: minimum 44x44px for interactive elements") against every
 * `a[href], button, input, select, textarea, [role=button], [role=tab]` on
 * each student route, and writes every one under 44x44px — after excluding
 * elements that are not visible, are disabled, or are intentionally
 * screen-reader-only (`.sr-only` — a 1x1 clipped box is not a touch target
 * a sighted or motor-impaired user could tap, and flagging it would just be
 * noise a page fix could never resolve) — to
 * reports/benchmarks/raw/touch-targets.json.
 */

const MIN_TARGET_PX = 44;

const STUDENT_ROUTES = [
  "/dashboard",
  "/career",
  "/goals",
  "/orientation",
  "/settings",
  "/appointments",
  "/memory",
] as const;

const INTERACTIVE_SELECTOR = "a[href], button, input, select, textarea, [role=button], [role=tab]";

const OUTPUT_PATH = join(process.cwd(), "reports/benchmarks/raw/touch-targets.json");

interface UndersizedTarget {
  route: string;
  tag: string;
  selector: string;
  width: number;
  height: number;
  label: string;
}

interface ElementInfo {
  tag: string;
  label: string;
  id: string;
  disabled: boolean;
  hiddenForScreenReaderOnly: boolean;
}

async function describeElement(handle: ElementHandle<Element>): Promise<ElementInfo> {
  return handle.evaluate((el) => {
    const element = el as HTMLElement;
    const ariaLabel = element.getAttribute("aria-label");
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    return {
      tag: element.tagName.toLowerCase(),
      label: ariaLabel ?? text,
      id: element.id ?? "",
      disabled:
        element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
      hiddenForScreenReaderOnly: element.closest(".sr-only") !== null,
    };
  });
}

test.describe("Benchmark data: touch targets at 375px", () => {
  test("collects undersized interactive elements across student routes", async ({ browser }) => {
    const context = await loginContext(browser, E2E_STUDENT);
    const undersized: UndersizedTarget[] = [];
    let totalInteractive = 0;
    let totalExcluded = 0;

    try {
      const page = await context.newPage();
      await page.setViewportSize({ width: 375, height: 667 });

      for (const route of STUDENT_ROUTES) {
        await page.goto(route);
        // Same settle window as e2e/a11y-authenticated.spec.ts — authenticated
        // pages hydrate client panels after load.
        await page.waitForTimeout(1_500);

        const handles = await page.$$(INTERACTIVE_SELECTOR);
        for (const handle of handles) {
          const isVisible = await handle.isVisible();
          if (!isVisible) continue;

          const info = await describeElement(handle);
          if (info.disabled || info.hiddenForScreenReaderOnly) {
            totalExcluded++;
            continue;
          }

          const box = await handle.boundingBox();
          if (!box) continue;

          totalInteractive++;
          const width = Math.round(box.width);
          const height = Math.round(box.height);
          if (width < MIN_TARGET_PX || height < MIN_TARGET_PX) {
            undersized.push({
              route,
              tag: info.tag,
              selector: info.id ? `${info.tag}#${info.id}` : info.tag,
              width,
              height,
              label: info.label,
            });
          }
        }
      }
    } finally {
      await context.close();
    }

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          viewport: { width: 375, height: 667 },
          minTargetPx: MIN_TARGET_PX,
          routes: STUDENT_ROUTES,
          totalInteractive,
          totalExcluded,
          undersized,
        },
        null,
        2,
      ),
    );
  });
});
