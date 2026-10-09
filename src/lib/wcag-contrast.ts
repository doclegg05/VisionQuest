/** WCAG 2.x relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast ratio between two #rrggbb colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Reads a token's value per theme from globals.css source: light is the first
 * declaration, dark the second (or the first when the token has no dark value).
 */
export function cssTokenValue(css: string, name: string, theme: "light" | "dark"): string | undefined {
  const values = [...css.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "gm"))].map((m) => m[1].trim());
  if (values.length === 0) return undefined;
  return theme === "dark" && values.length > 1 ? values[1] : values[0];
}

/** An sRGB color with alpha, channels 0-255 and alpha 0-1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses #rrggbb or rgb()/rgba() with comma-separated channels. */
export function parseColor(value: string): Rgba {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const fn = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  throw new Error(`cannot parse color "${value}"`);
}

/** Paints `top` over an opaque `bottom` and returns the result as #rrggbb. */
export function composite(top: Rgba, bottom: Rgba): string {
  const mix = (t: number, b: number) => Math.round(t * top.a + b * (1 - top.a));
  return `#${[mix(top.r, bottom.r), mix(top.g, bottom.g), mix(top.b, bottom.b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
