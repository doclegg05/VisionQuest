import palette from "./spokes-palette.json";
import { parseColor } from "./wcag-contrast";

/**
 * The SPOKES palette (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 2.1). spokes-palette.json is the single source: globals.palette.test.ts
 * and the spokes/no-off-palette-color lint rule read it too.
 */
export const SPOKES_COLORS: ReadonlyMap<string, string> = new Map(Object.entries(palette.colors));

function colorNamed(name: string): string {
  const hex = SPOKES_COLORS.get(name);
  if (!hex) throw new Error(`spokes-palette.json chartSeries names unknown color "${name}"`);
  return hex;
}

/** Chart series in an order where neighbors differ in lightness, not only hue. */
export const SPOKES_CHART_SERIES: readonly string[] = palette.chartSeries.map(colorNamed);

const channels = (hex: string) => {
  const { r, g, b } = parseColor(hex);
  return [r, g, b] as const;
};
const PALETTE_RGB = new Set([...SPOKES_COLORS.values()].map((hex) => channels(hex).join(",")));
const ALLOWED_NAMED = new Set(["white", "transparent", "currentcolor"]);

function normalizeHex(value: string): string {
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const withAlpha = value.match(/^#([0-9a-f]{6})[0-9a-f]{2}$/);
  return withAlpha ? `#${withAlpha[1]}` : value;
}

/** True when a CSS color literal is a SPOKES palette color at any alpha. */
export function isPaletteColor(literal: string): boolean {
  const value = literal.trim().toLowerCase();
  if (ALLOWED_NAMED.has(value)) return true;
  if (!/^#[0-9a-f]{3,8}$|^rgba?\(/.test(value)) return false;
  try {
    return PALETTE_RGB.has(channels(normalizeHex(value)).join(","));
  } catch {
    return false; // parseColor rejects modern space-separated syntax: not allowed in this codebase.
  }
}

/** Name of the palette color closest to `hex` in RGB distance, for hand fixes. */
export function nearestPaletteColor(hex: string): string {
  const [r, g, b] = channels(normalizeHex(hex.toLowerCase()));
  let best = { name: "", distance: Infinity };
  for (const [name, value] of SPOKES_COLORS) {
    const [pr, pg, pb] = channels(value);
    const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (distance < best.distance) best = { name, distance };
  }
  return best.name;
}
