import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `dark:` variant must follow the app's theme, not the operating system's.
 *
 * VisionQuest themes with `data-theme` on <html> (cookie-driven, resolved
 * server-side in layout.tsx). Tailwind 4's stock `dark:` variant keys off the
 * `prefers-color-scheme` media query instead. Left unwired, the two disagree
 * whenever a student's OS setting differs from their in-app choice, and only
 * half of every `bg-x-50 dark:bg-x-950` pair applies — which shipped white body
 * text on a pale green card, a plain WCAG AA failure for an audience this
 * project holds to AA (found 2026-08-20).
 *
 * This is a fast structural guard so the regression is caught by `npm test` in
 * the gating CI job; e2e/theme-variant.spec.ts proves the same thing end to end
 * in a real browser.
 */

const CSS_PATH = join(process.cwd(), "src/app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/** Strip /* … *​/ comments so prose about the rule can't satisfy these checks. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("globals.css — the dark: variant is wired to [data-theme]", () => {
  it("declares a custom dark variant", () => {
    assert.match(
      cssCode,
      /@custom-variant\s+dark\s*\(/,
      "expected an `@custom-variant dark (...)` declaration in globals.css",
    );
  });

  it("keys that variant on [data-theme=\"dark\"], not prefers-color-scheme", () => {
    const declaration = cssCode.match(/@custom-variant\s+dark\s*\(([^;]*)\);/);
    assert.ok(declaration, "expected a terminated @custom-variant dark (...) declaration");

    const body = declaration[1];
    assert.match(body, /\[data-theme=["']dark["']\]/, `variant must select on the theme attribute, got: ${body}`);
    assert.ok(
      !/prefers-color-scheme/.test(body),
      "the app's theme is an attribute, never the OS media query",
    );
  });

  it("covers both the themed element and its descendants", () => {
    const declaration = cssCode.match(/@custom-variant\s+dark\s*\(([^;]*)\);/);
    assert.ok(declaration);

    // data-theme lives on <html>, so nearly every dark: utility sits on a
    // descendant. A variant matching only the attribute holder itself would
    // compile without error and style almost nothing.
    const attrSelectors = declaration[1].match(/\[data-theme=["']dark["']\]/g) ?? [];
    assert.ok(
      attrSelectors.length >= 2,
      `expected the variant to match the themed element AND its descendants, got: ${declaration[1]}`,
    );
  });

  it("still defines both theme palettes on the attribute", () => {
    // Guards the other half of the contract: the variant is only correct
    // because the palettes hang off [data-theme].
    assert.match(cssCode, /\[data-theme=["']light["']\]/);
    assert.match(cssCode, /\[data-theme=["']dark["']\]/);
  });
});
