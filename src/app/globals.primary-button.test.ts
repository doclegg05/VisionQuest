import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The shared primary button must read at 4.5:1 on every color its gradient
 * passes through, in both themes.
 *
 * It painted color: white over a gradient through #37b550 and #62c977: 2.66:1
 * and 2.07:1 in light, and 2.04:1 on the dark theme's green. The token file
 * already carried --on-accent for this; the button never used it. axe reports
 * gradient backgrounds as "incomplete", not as violations, which is how the
 * authenticated contrast gate stayed green (HIG review A-2).
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
type Theme = "light" | "dark";

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Light values are a token's first declaration, dark its second (or the first if it has none). */
function tokenValue(name: string, theme: Theme): string {
  const values = [...css.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "gm"))].map((m) => m[1].trim());
  assert.ok(values.length > 0, `${name} is not declared`);
  return theme === "dark" && values.length > 1 ? values[1] : values[0];
}

/** Resolves a hex, var(--x), or color-mix(in srgb, <color> N%, black) to a hex. */
function resolve(expr: string, theme: Theme): string {
  const value = expr.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (/^white$/i.test(value)) return "#ffffff";
  const variable = value.match(/^var\((--[\w-]+)\)$/);
  if (variable) return resolve(tokenValue(variable[1], theme), theme);
  const mix = value.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*black\)$/);
  if (mix) {
    const base = resolve(mix[1], theme).slice(1);
    const share = Number(mix[2]) / 100;
    return `#${[0, 2, 4].map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * share).toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error(`cannot resolve color "${value}"`);
}

function primaryButtonRule(): { color: string; stops: string[] } {
  const rule = css.match(/\.primary-button\s*\{([^}]*)\}/);
  assert.ok(rule, ".primary-button rule not found");
  const color = rule[1].match(/(?:^|;)\s*color:\s*([^;]+);/)?.[1].trim() ?? "";
  const gradient = rule[1].match(/background:\s*linear-gradient\((.*)\);/)?.[1] ?? "";
  const stops = splitTopLevel(gradient)
    .slice(1)
    .map((stop) => stop.trim().replace(/\s+\d+%$/, ""));
  return { color, stops };
}

/** Splits on commas outside parentheses, so color-mix(a, b) stays one stop. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    current += char;
  }
  return [...parts, current];
}

describe(".primary-button contrast", () => {
  it("takes its ink from --on-accent", () => {
    assert.equal(primaryButtonRule().color, "var(--on-accent)");
  });

  for (const theme of ["light", "dark"] as const) {
    it(`clears 4.5:1 at every gradient stop in the ${theme} theme`, () => {
      const { color, stops } = primaryButtonRule();
      assert.ok(stops.length > 0, "no gradient stops found");
      const ink = resolve(color, theme);
      const failing = stops
        .map((stop) => ({ stop, ratio: contrast(ink, resolve(stop, theme)) }))
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ stop, ratio }) => `${stop} ${ratio.toFixed(2)}:1`);
      assert.deepEqual(failing, [], `${theme}: ink ${ink} fails on these stops`);
    });
  }
});

describe("NavBar accent fills", () => {
  it("do not pair the hard-coded brand green with light ink", () => {
    const lines = readFileSync(join(process.cwd(), "src/components/ui/NavBar.tsx"), "utf8").split("\n");
    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /#37b550|#2a8a3c/i.test(line) && /text-white|text-\[#f0efe8\]/i.test(line))
      .map(({ n }) => `NavBar.tsx:${n}`);
    assert.deepEqual(offenders, [], "use bg-[var(--accent-green)] with text-[var(--on-accent)]");
  });
});
