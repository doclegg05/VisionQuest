// src/app/globals.palette.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPaletteColor } from "@/lib/spokes-palette";

/**
 * Every color in globals.css is a SPOKES palette color at some alpha
 * (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md, Design 2.1).
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|rgba?\([^)]*\)|(?:hsla?|oklch|oklab|lab|lch)\([^)]*\)/g;
const NAMED = /[\s:(,](black|red|green|blue|yellow|orange|purple|gray|grey|pink|navy|teal|gold|silver|maroon|olive|lime|aqua|fuchsia)(?=[\s,;)])/g;

describe("globals.css palette", () => {
  it("uses only SPOKES palette colors", () => {
    const offenders = [...css.matchAll(LITERAL)].map((m) => m[0]).filter((value) => !isPaletteColor(value));
    assert.deepEqual([...new Set(offenders)], []);
  });

  it("uses no named color other than white and transparent", () => {
    const offenders = [...css.matchAll(NAMED)].map((m) => m[1]);
    assert.deepEqual([...new Set(offenders)], []);
  });
});
