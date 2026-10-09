import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";

/**
 * Every tinted pair (a translucent -bg with its -text) must clear 4.5:1 where
 * it is actually drawn: on the page base and on a raised card, in both themes.
 * The dark error pair cleared 5.04:1 on the base but 4.35:1 on a card, and 16
 * places use it on cards (HIG Phase 2 review, g01 and g09).
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const PAIRS = [
  "badge-success", "badge-warning", "badge-error", "badge-info",
  "urgency-critical", "urgency-high", "urgency-medium",
  "program-spokes", "program-ae", "program-ietp",
];

function token(name: string, theme: "light" | "dark"): string {
  const value = cssTokenValue(css, name, theme);
  assert.ok(value, `${name} is not declared`);
  return value;
}

for (const theme of ["light", "dark"] as const) {
  describe(`tinted pairs, ${theme} theme`, () => {
    const base = parseColor(token("--surface-base", theme));
    const card = parseColor(composite(parseColor(token("--surface-raised", theme)), base));
    for (const pair of PAIRS) {
      it(`--${pair} clears 4.5:1 on the page and on a card`, () => {
        const tint = parseColor(token(`--${pair}-bg`, theme));
        const text = token(`--${pair}-text`, theme);
        for (const [where, surface] of [["page", base], ["card", card]] as const) {
          const ratio = contrastRatio(text, composite(tint, surface));
          assert.ok(ratio >= 4.5, `${where}: ${text} on ${pair}-bg is ${ratio.toFixed(2)}:1`);
        }
      });
    }
  });
}
