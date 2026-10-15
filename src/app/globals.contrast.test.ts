// src/app/globals.contrast.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composite, contrastRatio, cssTokenValue, parseColor, type Rgba } from "@/lib/wcag-contrast";

/**
 * Every text and background pair the SPOKES spec names, in both themes, on
 * every ground a component sits on: the page, a card, a card's sheen-lit top,
 * and a muted panel inside a card (the same grounds as
 * globals.badge-contrast.test.ts). Spec: Design 2.2 to 2.7, revised.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ROLES = ["danger", "success", "warning", "info", "brand-deep"] as const;
type Theme = "light" | "dark";

function token(name: string, theme: Theme): string {
  const value = cssTokenValue(css, name, theme);
  assert.ok(value, `${name} is not declared`);
  return value;
}
const toHex = (color: Rgba) => composite({ ...color, a: 1 }, color);
const over = (name: string, theme: Theme, ground: Rgba) => composite(parseColor(token(name, theme)), ground);

function assertOnGrounds(ink: (ground: Rgba) => string, grounds: ReadonlyArray<readonly [string, Rgba]>, floor: number): void {
  const failing = grounds
    .map(([where, ground]) => ({ where, ratio: contrastRatio(ink(ground), toHex(ground)) }))
    .filter(({ ratio }) => ratio < floor)
    .map(({ where, ratio }) => `${where} ${ratio.toFixed(2)}:1`);
  assert.deepEqual(failing, []);
}

for (const theme of ["light", "dark"] as const) {
  describe(`SPOKES contrast, ${theme} theme`, () => {
    const page = parseColor(token("--surface-base", theme));
    const card = parseColor(over("--surface-raised", theme, page));
    const cardTop = parseColor(over("--surface-sheen", theme, card));
    const mutedPanel = parseColor(over("--surface-muted", theme, card));
    const grounds = [["page", page], ["card", card], ["card top", cardTop], ["muted panel", mutedPanel]] as const;

    for (const ink of ["--ink-strong", "--ink-muted", "--ink-faint"]) {
      it(`${ink} clears 4.5:1 on every ground`, () => {
        assertOnGrounds((ground) => over(ink, theme, ground), grounds, 4.5);
      });
    }

    for (const role of ROLES) {
      it(`--${role}-text clears 4.5:1 on every ground`, () => {
        assertOnGrounds((ground) => over(`--${role}-text`, theme, ground), grounds, 4.5);
      });
      it(`--${role}-text clears 4.5:1 on --${role}-soft over every ground`, () => {
        const tinted = grounds.map(([where, ground]) => [where, parseColor(over(`--${role}-soft`, theme, ground))] as const);
        assertOnGrounds((ground) => over(`--${role}-text`, theme, ground), tinted, 4.5);
      });
      it(`--${role}-on clears 4.5:1 on --${role}-fill`, () => {
        const ratio = contrastRatio(token(`--${role}-on`, theme), token(`--${role}-fill`, theme));
        assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
      });
    }

    for (const [ink, fill] of [["--on-accent", "--accent-green"], ["--on-primary", "--primary"], ["--on-error", "--error"]]) {
      it(`${ink} clears 4.5:1 on ${fill}`, () => {
        const ratio = contrastRatio(token(ink, theme), token(fill, theme));
        assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
      });
    }

    for (const edge of ["--focus-outline", "--border-control", "--progress-edge"]) {
      it(`${edge} clears 3:1 on the page, a card, and a muted panel`, () => {
        assertOnGrounds((ground) => over(edge, theme, ground), [grounds[0], grounds[1], grounds[3]], 3);
      });
    }

    it("--chat-error-text clears 4.5:1 on its banner", () => {
      const area = parseColor(token("--chat-area-bg", theme));
      const banner = parseColor(over("--chat-error-bg", theme, area));
      assertOnGrounds((ground) => over("--chat-error-text", theme, ground), [["chat banner", banner]], 4.5);
    });

    it("--toast-celebration-text clears 4.5:1 on its toast", () => {
      const toast = parseColor(over("--toast-celebration-bg", theme, card));
      assertOnGrounds((ground) => over("--toast-celebration-text", theme, ground), [["toast", toast]], 4.5);
    });
  });
}
