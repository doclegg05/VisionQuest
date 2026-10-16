// scripts/lib/spokes-class-map.mjs
/**
 * Maps one Tailwind class onto the SPOKES role utilities defined in
 * src/app/globals.css (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 5.1). Pure: no I/O. scripts/lib/spokes-source-rewrite.mjs applies it to files.
 */
export const HUES = "red|rose|pink|fuchsia|emerald|green|lime|amber|yellow|orange|blue|sky|cyan|teal|indigo|violet|purple|slate|gray|zinc|neutral|stone";
export const HUE_PREFIX = "bg|text|border(?:-[xytrbl])?|from|via|to|ring|fill|stroke|outline|divide|decoration|accent|caret|placeholder|shadow";
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
  // Legacy text aliases. Their dark values are fills too, so text moves onto the matching role.
  "--accent-strong": "success", "--accent-secondary": "info", "--accent-tertiary": "warning",
  // The brand green is a fill (#37b550, 2.7:1 on white), so green text moves onto the success role.
  "--accent": "success",
});
const NAMED_TEXT_ROLE = Object.freeze({ "accent-red": "danger", "accent-green": "success", "accent-blue": "info", "accent-gold": "warning" });
const RADIUS_STEPS = Object.freeze([["sm", 6], ["md", 8], ["lg", 12], ["xl", 16], ["2xl", 20], ["3xl", 24]]);
const SOFT_PREFIXES = new Set(["bg", "from", "via", "to"]);
const LINE_PREFIX = /^(border(?:-[xytrbl])?|ring|outline|divide)$/;
const HEAVY = new Set(["font-semibold", "font-bold", "font-extrabold", "font-black"]);
const DISPLAY_FAMILY = "font-[family-name:var(--font-display)]";
const STATE_VARIANTS = Object.freeze(["hover:", "focus:", "focus-visible:", "active:", "group-hover:"]);
// A fixed light or dark color: it does not switch with the theme, so a removed dark: sibling breaks dark mode.
const FIXED_COLOR_RE = /^(?:[a-z0-9-]+:)*(?:bg|text|border|from|via|to|ring|fill|stroke)-(?:white|black|\[)/;
const DARK_REVIEW_REASON = "dark: color removed but the list keeps a fixed color; check the dark theme by hand";
const STATE_REVIEW_REASON = "state color now matches the base color; choose a visibly different state, for example /90";

const V = "((?:[a-z0-9-]+:)*)";
const HUE_RE = new RegExp(`^${V}(${HUE_PREFIX})-(${HUES})-(\\d{2,3})(\\/\\d{1,3})?$`);
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

const BRACKET_REASON = "bracket variant; rewrite by hand";

// `[&>svg]:rounded-[10px]` and `data-[state=open]:bg-red-50` carry a variant the map cannot parse. The class after
// the last `]:` is the one it would have changed, so a mappable class there is flagged rather than skipped.
function bracketVariantRule(token) {
  if (!token.includes("]:")) return null;
  return mapClass(token.slice(token.lastIndexOf("]:") + 2))?.rule ?? null;
}

function classify(token, usesDisplay, enabled) {
  if (usesDisplay && HEAVY.has(token)) return enabled.has("display-weight") ? { to: null } : {};
  const mapped = mapClass(token);
  if (mapped && enabled.has(mapped.rule)) return "review" in mapped ? { review: mapped.review } : { to: mapped.to };
  const bracketRule = mapped ? null : bracketVariantRule(token);
  if (bracketRule && enabled.has(bracketRule)) return { review: BRACKET_REASON };
  if (!mapped && enabled.has("hue") && HUE_ANYWHERE.test(token)) return { review: "unrecognized variant around an off-palette hue" };
  return {};
}

// `classList.split(/(\s+)/)` alternates class names (even indexes, "" at the ends) with whitespace (odd indexes).
const isName = (part, index) => index % 2 === 0 && part !== "";
const usesDisplayFamily = (token) => token === "font-display" || token.endsWith(DISPLAY_FAMILY);
const hasDarkVariant = (token) => token.split(":").slice(0, -1).includes("dark");

function stripStateVariant(token) {
  const variant = STATE_VARIANTS.find((prefix) => token.startsWith(prefix));
  return variant ? token.slice(variant.length) : null;
}

function collectChanges(parts, outcomes) {
  const changes = [];
  const review = [];
  parts.forEach((part, index) => {
    const outcome = outcomes[index];
    if (!outcome) return;
    if (outcome.review) review.push({ token: part, reason: outcome.review });
    if (outcome.to !== undefined) changes.push({ from: part, to: outcome.to });
  });
  return { changes, review };
}

// A deleted class takes the whitespace before it; the first class has none, so it takes the whitespace after.
function deletedIndexes(parts, outcomes) {
  const firstName = parts.findIndex(isName);
  const drop = new Set();
  outcomes.forEach((outcome, index) => {
    if (outcome?.to !== null) return;
    drop.add(index);
    drop.add(index === firstName ? index + 1 : index - 1);
  });
  return drop;
}

function renderParts(parts, outcomes) {
  const drop = deletedIndexes(parts, outcomes);
  return parts
    .map((part, index) => (typeof outcomes[index]?.to === "string" ? outcomes[index].to : part))
    .filter((_, index) => !drop.has(index))
    .join("");
}

function darkReviews(parts, outcomes, kept, hadOtherReviews) {
  const fixedKept = kept.some((token) => FIXED_COLOR_RE.test(token));
  if (!fixedKept && !hadOtherReviews) return [];
  return parts
    .filter((part, index) => outcomes[index]?.to === null && hasDarkVariant(part))
    .map((token) => ({ token, reason: DARK_REVIEW_REASON }));
}

function stateReviews(changes, kept) {
  return changes.flatMap(({ from, to }) => {
    const base = to === null ? null : stripStateVariant(to);
    const collides = base !== null && !base.includes(":") && kept.includes(base);
    return collides ? [{ token: from, reason: STATE_REVIEW_REASON }] : [];
  });
}

/**
 * Rewrites a whitespace-separated class list. Only the classes that change are rewritten;
 * all other text, including line breaks and indentation, comes back byte for byte.
 */
export function rewriteClassList(classList, rules = ALL_RULES) {
  const enabled = new Set(rules);
  const parts = classList.split(/(\s+)/);
  const usesDisplay = parts.some((part, index) => isName(part, index) && usesDisplayFamily(part));
  const outcomes = parts.map((part, index) => (isName(part, index) ? classify(part, usesDisplay, enabled) : null));
  const { changes, review } = collectChanges(parts, outcomes);
  if (changes.length === 0) return { output: classList, changes, review };
  const output = renderParts(parts, outcomes);
  const kept = output.split(/\s+/).filter(Boolean);
  const darkFlags = darkReviews(parts, outcomes, kept, review.length > 0);
  return { output, changes, review: [...review, ...darkFlags, ...stateReviews(changes, kept)] };
}
