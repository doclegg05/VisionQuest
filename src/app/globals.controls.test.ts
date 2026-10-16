import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Form controls draw their edge with --border-control, the 3:1 border (spec Design 2.2).
 *
 * --border is a 1.2:1 hairline for cards and dividers. A text box outlined with it has no
 * visible edge for a low-vision user (WCAG 1.4.11 asks 3:1 for the boundary of a control),
 * so .field, .textarea-field, .select-field and .theme-input must not use it.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Returns the declaration block of the rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const wanted = selector.replace(/\s+/g, " ").trim();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].replace(/\s+/g, " ").trim() === wanted) return match[2];
  }
  assert.fail(`no rule with the selector "${wanted}" in globals.css`);
}

/** The color a rule gives its edge: the last border or border-color declaration. */
function borderDeclaration(body: string): string {
  const declarations = [...body.matchAll(/^\s*(border|border-color):\s*([^;]+);/gm)];
  assert.ok(declarations.length > 0, "the rule declares no border or border-color");
  return declarations[declarations.length - 1][2].trim();
}

describe("control borders", () => {
  const controls: ReadonlyArray<readonly [string, string]> = [
    [".field, .textarea-field, .select-field", "the .field rule"],
    [".theme-input", "the .theme-input rule"],
  ];

  for (const [selector, label] of controls) {
    it(`${label} draws its edge with --border-control`, () => {
      const border = borderDeclaration(ruleBody(selector));
      assert.ok(border.includes("var(--border-control)"), `${label} uses "${border}"`);
      assert.ok(!/var\(--border\)/.test(border), `${label} still reads the 1.2:1 hairline "${border}"`);
    });
  }
});
