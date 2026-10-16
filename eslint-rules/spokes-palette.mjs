// eslint-rules/spokes-palette.mjs
/**
 * spokes/no-off-palette-color: component colors stay on the SPOKES palette and
 * text stays at 13px or larger (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 6.4). Its own rule rather than no-restricted-syntax selectors: flat
 * config replaces that rule's options per block, so a warn-only block for
 * unswept folders would also weaken the student-log and studentAlert selectors.
 */
import palette from "../src/lib/spokes-palette.json" with { type: "json" };

const HUES = "red|rose|pink|fuchsia|emerald|green|lime|amber|yellow|orange|blue|sky|cyan|teal|indigo|violet|purple|slate|gray|zinc|neutral|stone";
const EDGE = "[\\s\"'`:]";
const HUE_CLASS = new RegExp(`(?:^|${EDGE})((?:bg|text|border(?:-[xytrbl])?|from|via|to|ring|fill|stroke|outline|divide|decoration|accent|caret|placeholder|shadow)-(?:${HUES})-\\d{2,3}(?:\\/\\d{1,3})?)(?=$|[\\s"'\`])`);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/g;
// rgb()/rgba() with comma or space channels. Tailwind arbitrary values write
// spaces as underscores, so those separate channels too. The lookbehind skips
// letters and digits only, because "_" precedes the function in shadow-[0_4px_12px_rgba(...)].
const RGB_SEP = "(?:\\s*,\\s*|[\\s_]+)";
const RGB_CALL = new RegExp(`(?<![A-Za-z0-9])rgba?\\(\\s*(\\d{1,3})${RGB_SEP}(\\d{1,3})${RGB_SEP}(\\d{1,3})`, "gi");
const ARBITRARY_TEXT = new RegExp(`(?:^|${EDGE})(text-\\[(\\d*\\.?\\d+)(px|rem)\\])(?=$|[\\s"'\`])`, "g");
const SOFT_TEXT = new RegExp(`(?:^|${EDGE})(text-(danger|success|warning|info|brand-deep)-soft)(?=$|[\\s"'\`])`);
const PALETTE = new Set(Object.values(palette.colors));
// Palette colors as "r,g,b" keys. Alpha is ignored, so a tint of a palette color passes.
const PALETTE_RGB = new Set(
  [...PALETTE].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")),
);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Keep component colors on the SPOKES palette and text at 13px or larger" },
    schema: [],
    messages: {
      hue: "{{cls}} is outside the SPOKES palette. Use a role utility (bg-danger, text-success, border-info): spec Design 5.1.",
      hexTsx: "Raw hex {{hex}} in a component. Use a token, var(--...), or a role utility.",
      hexTs: "{{hex}} is not a SPOKES palette color (src/lib/spokes-palette.json).",
      rgb: "{{value}} is not a SPOKES palette color (src/lib/spokes-palette.json). Use a token or a palette color.",
      smallText: "{{cls}} renders below the 13px floor. Use text-xs or larger.",
      softText: "{{cls}} paints text in a background tint and fails contrast. Use text-{{role}}.",
    },
  },
  create(context) {
    const isTsx = context.filename.endsWith(".tsx");
    function offPaletteRgb(text) {
      for (const match of text.matchAll(RGB_CALL)) {
        const channels = [match[1], match[2], match[3]].map(Number);
        if (!PALETTE_RGB.has(channels.join(","))) return `rgb(${channels.join(", ")})`;
      }
      return null;
    }
    function firstProblem(text) {
      const hue = text.match(HUE_CLASS);
      if (hue) return { messageId: "hue", data: { cls: hue[1] } };
      for (const match of text.matchAll(HEX)) {
        const hex = match[0].toLowerCase();
        if (isTsx) return { messageId: "hexTsx", data: { hex } };
        if (!PALETTE.has(hex.slice(0, 7))) return { messageId: "hexTs", data: { hex } };
      }
      const rgb = offPaletteRgb(text);
      if (rgb) return { messageId: "rgb", data: { value: rgb } };
      for (const match of text.matchAll(ARBITRARY_TEXT)) {
        const px = Number(match[2]) * (match[3] === "rem" ? 16 : 1);
        if (px < 13) return { messageId: "smallText", data: { cls: match[1] } };
      }
      const soft = text.match(SOFT_TEXT);
      return soft ? { messageId: "softText", data: { cls: soft[1], role: soft[2] } } : null;
    }
    function check(node, text) {
      const problem = firstProblem(text);
      if (problem) context.report({ node, ...problem });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

export default rule;
