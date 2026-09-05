import type {
  BenchTier,
  BenchUnit,
  DashboardMetric,
  Movement,
  SuiteState,
} from "@/lib/benchmarks/dashboard";

/**
 * Plain words for the benchmark dashboard.
 *
 * Everything a reader sees is decided here, and nothing here decides a
 * verdict — the status arrives already settled by the runner's own
 * `metricStatus()`. This file only turns a settled fact into a sentence a
 * non-coder can read, which is why it lives under the readability gate's
 * scan roots.
 *
 * Colour never carries meaning on its own: every tone below is paired with a
 * word, and the word is what the page states.
 */

export type Tone = "good" | "warn" | "bad" | "info" | "quiet";

export const TONE_CLASS: Record<Tone, string> = {
  good: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]",
  warn: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
  bad: "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]",
  info: "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]",
  quiet: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
};

/** What each suite state means, in words a reader can act on. */
export const STATE_LABEL: Record<SuiteState, { label: string; tone: Tone }> = {
  pass: { label: "Passing", tone: "good" },
  watch: { label: "Slipping", tone: "warn" },
  fail: { label: "Below the floor", tone: "bad" },
  info: { label: "Tracked", tone: "info" },
  skipped: { label: "Could not run", tone: "quiet" },
  error: { label: "The test broke", tone: "bad" },
  "not-run": { label: "Not run yet", tone: "quiet" },
};

export const TIER_LABEL: Record<BenchTier, string> = {
  gate: "Blocks a merge",
  watch: "Watched only",
  nightly: "Runs each night",
  manual: "Run by hand",
};

/** Area names as headings. Unknown areas fall back to the raw name. */
export const AREA_LABEL: Record<string, string> = {
  safety: "Keeping students safe",
  "sage-quality": "How well Sage answers",
  quality: "Answer quality",
  retrieval: "Finding the right document",
  performance: "Speed",
  a11y: "Easy to read and use",
  "data-integrity": "Data we can trust",
  ops: "Running the service",
  meta: "The tests themselves",
  nudges: "Text-message check-ins",
  connect: "Matching students with employers",
  other: "Everything else",
};

export function areaLabel(area: string): string {
  return AREA_LABEL[area] ?? area;
}

/** How a value moved against the last agreed number. */
export const MOVEMENT_LABEL: Record<Movement, { label: string; tone: Tone }> = {
  better: { label: "Better", tone: "good" },
  worse: { label: "Worse", tone: "warn" },
  same: { label: "Same", tone: "quiet" },
  unknown: { label: "No number to compare", tone: "quiet" },
};

/**
 * Short forms that a plain reading of a metric id would leave as noise.
 * Anything not listed keeps its own word, so a suite added next month still
 * reads sensibly without an edit here.
 */
const WORD: Record<string, string> = {
  fp: "false alarm",
  pii: "private info",
  rls: "row security",
  ms: "milliseconds",
  gsm7: "plain text",
  usd: "dollars",
  p50: "middle",
  p95: "near worst",
  top1: "top pick",
  top3: "top three",
  max: "highest",
  eslint: "lint",
  offtopic: "off topic",
  gsm: "text",
  n: "count",
};

/**
 * Turn a metric id into readable words. The raw id stays on screen beside it,
 * so this is a help, never a replacement.
 */
export function metricLabel(id: string): string {
  const words = id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => WORD[part.toLowerCase()] ?? part.toLowerCase())
    .join(" ");
  if (!words) return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function round(value: number, places: number): string {
  return value.toFixed(places);
}

/**
 * Format one measured number for a reader.
 *
 * A ratio is shown as a percent because "98.5%" is read correctly by more
 * people than "0.985". The stored value is untouched; only the printing
 * changes, and the floor is printed the same way so the two always compare.
 */
export function formatValue(
  value: number | null,
  unit: BenchUnit,
  displayUnit: string | null = null,
): string {
  if (value === null) return "—";
  if (displayUnit === "usd") return `$${round(value, 2)}`;
  switch (unit) {
    case "ratio":
      return `${round(value * 100, 1)}%`;
    case "percent":
      return `${round(value, 1)}%`;
    case "ms":
      return value >= 1000 ? `${round(value / 1000, 1)} seconds` : `${Math.round(value)} ms`;
    case "seconds":
      return `${round(value, 1)} seconds`;
    case "grade":
      return `grade ${round(value, 1)}`;
    default: {
      const whole = Number.isInteger(value) ? String(value) : round(value, 2);
      return displayUnit ? `${whole} ${displayUnit}` : whole;
    }
  }
}

/** The size of a change, printed the same way as the value it came from. */
export function formatChange(metric: DashboardMetric): string {
  if (metric.delta === null) return "";
  return formatValue(Math.abs(metric.delta), metric.unit, metric.displayUnit);
}

/** Which way is good for this metric, said out loud. */
export function directionHint(metric: DashboardMetric): string {
  if (metric.exact) return "Must match the baseline exactly.";
  if (metric.direction === "higher") return "Higher is better.";
  if (metric.direction === "lower") return "Lower is better.";
  return "";
}

/** What the floor promises, or why there is none. */
export function floorText(metric: DashboardMetric): string {
  if (metric.exact) return "Must match";
  if (metric.floor === null) return "No floor";
  const limit = formatValue(metric.floor, metric.unit, metric.displayUnit);
  return metric.direction === "lower" ? `${limit} or less` : `${limit} or more`;
}

/** One word for a metric's standing, plus the colour that goes with it. */
export function metricStanding(metric: DashboardMetric): { label: string; tone: Tone } {
  if (metric.tracked && metric.status === "info") return { label: "Tracked", tone: "info" };
  return STATE_LABEL[metric.status];
}

/**
 * A date a person can read. Fixed to a plain year-month-day form on purpose:
 * a locale-aware format would print differently on the server than in a
 * reader's browser, and this page is meant to be quoted in a meeting.
 */
export function formatMoment(iso: string | null): string {
  if (!iso) return "Never";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
