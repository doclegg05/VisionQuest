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
// CSS Color 4 named colors except white; only white, transparent, and currentColor are allowed.
const NAMED_COLORS = "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|whitesmoke|yellow|yellowgreen";
const NAMED = new RegExp(`[\\s:(,](${NAMED_COLORS})(?=[\\s,;)!])`, "gi");

describe("globals.css palette", () => {
  it("uses only SPOKES palette colors", () => {
    const offenders = [...css.matchAll(LITERAL)].map((m) => m[0]).filter((value) => !isPaletteColor(value));
    assert.deepEqual([...new Set(offenders)], []);
  });

  it("uses no named color other than white, transparent, and currentColor", () => {
    const offenders = [...css.matchAll(NAMED)].map((m) => m[1]);
    assert.deepEqual([...new Set(offenders)], []);
  });
});
