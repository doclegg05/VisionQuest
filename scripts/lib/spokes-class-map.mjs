// scripts/lib/spokes-class-map.mjs
/**
 * Maps one Tailwind class onto the SPOKES role utilities defined in
 * src/app/globals.css (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 5.1). Pure: no I/O. scripts/lib/spokes-source-rewrite.mjs applies it to files.
 */
export const HUES = "red|rose|pink|fuchsia|emerald|green|lime|amber|yellow|orange|blue|sky|cyan|teal|indigo|violet|purple|slate|gray|zinc|neutral|stone";
export const ALL_RULES = Object.freeze(["hue", "token-text", "display-family", "radius", "small-text", "display-weight"]);

const ROLE_BY_HUE = Object.freeze({
  red: "danger", rose: "danger", pink: "danger", fuchsia: "danger",
  emerald: "success", green: "success", lime: "success",
  amber: "warning", yellow: "warning", orange: "warning",
  blue: "info", sky: "info", cyan: "info", teal: "info",
  indigo: "brand-deep", violet: "brand-deep", purple: "brand-deep",
});
// Tokens used as both text and fill. Their dark values are fills, so text uses the role instead.
const TOKEN_TEXT_ROLE = Object.freeze({
  "--error": "danger", "--accent-red": "danger", "--success": "success", "--accent-green": "success",
  "--accent-blue": "info", "--primary": "info", "--accent-gold": "warning",
});
const NAMED_TEXT_ROLE = Object.freeze({ "accent-red": "danger", "accent-green": "success", "accent-blue": "info", "accent-gold": "warning" });
const RADIUS_STEPS = Object.freeze([["sm", 6], ["md", 8], ["lg", 12], ["xl", 16], ["2xl", 20], ["3xl", 24]]);
const SOFT_PREFIXES = new Set(["bg", "from", "via", "to"]);
const LINE_PREFIX = /^(border(?:-[xytrbl])?|ring|outline|divide)$/;
const HEAVY = new Set(["font-semibold", "font-bold", "font-extrabold", "font-black"]);
const DISPLAY_FAMILY = "font-[family-name:var(--font-display)]";

const V = "((?:[a-z0-9-]+:)*)";
const HUE_RE = new RegExp(`^${V}(bg|text|border(?:-[xytrbl])?|from|via|to|ring|fill|stroke|outline|divide|decoration|accent|caret|placeholder|shadow)-(${HUES})-(\\d{2,3})(\\/\\d{1,3})?$`);
const TOKEN_TEXT_RE = new RegExp(`^${V}text-\\[var\\((--[a-z-]+)\\)\\]$`);
const NAMED_TEXT_RE = new RegExp(`^${V}text-(accent-red|accent-green|accent-blue|accent-gold)(\\/\\d{1,3})?$`);
const RADIUS_RE = new RegExp(`^${V}rounded(-(?:tl|tr|bl|br|ss|se|es|ee|[trblse]))?-\\[(\\d*\\.?\\d+)(rem|px)\\]$`);
const SMALL_TEXT_RE = new RegExp(`^${V}text-\\[(\\d*\\.?\\d+)(rem|px)\\]$`);
const HUE_ANYWHERE = new RegExp(`-(?:${HUES})-\\d{2,3}`);

const toPx = (value, unit) => Number(value) * (unit === "rem" ? 16 : 1);
const OPACITY_TEXT = "text color with opacity loses contrast; pick a solid role";

function nearestRadius(px) {
  let best = RADIUS_STEPS[0];
  for (const step of RADIUS_STEPS) if (Math.abs(step[1] - px) <= Math.abs(best[1] - px)) best = step;
  return best[0];
}

function mapNeutral(variants, prefix, shade, opacity) {
  if (prefix === "text" && !opacity && shade >= 700) return { rule: "hue", to: `${variants}text-ink-strong` };
  if (prefix === "text" && !opacity && shade >= 400) return { rule: "hue", to: `${variants}text-ink-muted` };
  if (prefix === "bg" && shade <= 200) return { rule: "hue", to: `${variants}bg-surface-muted${opacity}` };
  if (LINE_PREFIX.test(prefix)) return { rule: "hue", to: `${variants}${prefix}-line${opacity}` };
  return { rule: "hue", review: `no SPOKES neutral for ${prefix}-${shade}; choose an ink or surface token` };
}

function mapHue([, variants, prefix, hue, shadeText, opacity = ""]) {
  if (variants.split(":").includes("dark")) return { rule: "hue", to: null }; // role tokens already switch per theme
  const shade = Number(shadeText);
  const role = ROLE_BY_HUE[hue];
  if (!role) return mapNeutral(variants, prefix, shade, opacity);
  if (prefix === "placeholder") return { rule: "hue", review: "placeholder text needs a contrast check; use placeholder:text-ink-faint" };
  if (prefix === "text" && opacity) return { rule: "hue", review: OPACITY_TEXT };
  const soft = SOFT_PREFIXES.has(prefix) && shade <= 200 ? "-soft" : "";
  return { rule: "hue", to: `${variants}${prefix}-${role}${soft}${opacity}` };
}

function mapDisplayFamily(token) {
  if (!token.endsWith(DISPLAY_FAMILY)) return null;
  const variants = token.slice(0, -DISPLAY_FAMILY.length);
  return variants === "" || variants.endsWith(":") ? { rule: "display-family", to: `${variants}font-display` } : null;
}

/** Maps one class. null means "not ours"; `to: null` means "delete it". */
export function mapClass(token) {
  const hue = token.match(HUE_RE);
  if (hue) return mapHue(hue);
  const tokenText = token.match(TOKEN_TEXT_RE);
  if (tokenText && TOKEN_TEXT_ROLE[tokenText[2]]) return { rule: "token-text", to: `${tokenText[1]}text-${TOKEN_TEXT_ROLE[tokenText[2]]}` };
  const namedText = token.match(NAMED_TEXT_RE);
  if (namedText) return namedText[3] ? { rule: "token-text", review: OPACITY_TEXT } : { rule: "token-text", to: `${namedText[1]}text-${NAMED_TEXT_ROLE[namedText[2]]}` };
  const family = mapDisplayFamily(token);
  if (family) return family;
  const radius = token.match(RADIUS_RE);
  if (radius) return { rule: "radius", to: `${radius[1]}rounded${radius[2] ?? ""}-${nearestRadius(toPx(radius[3], radius[4]))}` };
  const small = token.match(SMALL_TEXT_RE);
  if (small && toPx(small[2], small[3]) < 13) return { rule: "small-text", to: `${small[1]}text-xs` };
  return null;
}

function classify(token, usesDisplay, enabled) {
  if (usesDisplay && HEAVY.has(token)) return enabled.has("display-weight") ? { to: null } : {};
  const mapped = mapClass(token);
  if (mapped && enabled.has(mapped.rule)) return "review" in mapped ? { review: mapped.review } : { to: mapped.to };
  if (!mapped && enabled.has("hue") && HUE_ANYWHERE.test(token)) return { review: "unrecognized variant around an off-palette hue" };
  return {};
}

/** Rewrites a whitespace-separated class list. Untouched input comes back byte for byte. */
export function rewriteClassList(classList, rules = ALL_RULES) {
  const enabled = new Set(rules);
  const core = classList.trim();
  if (!core) return { output: classList, changes: [], review: [] };
  const tokens = core.split(/\s+/);
  const usesDisplay = tokens.some((t) => t === "font-display" || t.endsWith(DISPLAY_FAMILY));
  const changes = [];
  const review = [];
  const kept = [];
  for (const token of tokens) {
    const result = classify(token, usesDisplay, enabled);
    if (result.review) review.push({ token, reason: result.review });
    if (result.to === undefined) {
      kept.push(token);
      continue;
    }
    changes.push({ from: token, to: result.to });
    if (result.to !== null) kept.push(result.to);
  }
  if (changes.length === 0) return { output: classList, changes, review };
  const leading = classList.slice(0, classList.length - classList.trimStart().length);
  const trailing = classList.slice(classList.trimEnd().length);
  return { output: `${leading}${kept.join(" ")}${trailing}`, changes, review };
}
