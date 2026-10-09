import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";

/**
 * Every tinted pair (a translucent -bg with its -text) must clear 4.5:1 where
 * it is actually drawn, in both themes: on the page base, on a raised card, at
 * the top of a card where .surface-section, .panel, and .theme-card paint
 * --surface-sheen at full strength, and on a --surface-muted panel inside a
 * card. The dark error pair cleared 5.04:1 on the base but 4.35:1 on a card
 * (g01, g09); the sheen was missing from the model (correctness review).
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
    const cardTop = parseColor(composite(parseColor(token("--surface-sheen", theme)), card));
    const mutedPanel = parseColor(composite(parseColor(token("--surface-muted", theme)), card));
    const surfaces = [["page", base], ["card", card], ["card top", cardTop], ["muted panel", mutedPanel]] as const;
    for (const pair of PAIRS) {
      it(`--${pair} clears 4.5:1 on the page, a card, a card's top, and a muted panel`, () => {
        const tint = parseColor(token(`--${pair}-bg`, theme));
        const text = token(`--${pair}-text`, theme);
        for (const [where, surface] of surfaces) {
          const ratio = contrastRatio(text, composite(tint, surface));
          assert.ok(ratio >= 4.5, `${where}: ${text} on ${pair}-bg is ${ratio.toFixed(2)}:1`);
        }
      });
    }
  });
}
