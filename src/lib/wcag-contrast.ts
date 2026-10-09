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
