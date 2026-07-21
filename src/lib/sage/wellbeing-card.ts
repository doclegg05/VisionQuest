/**
 * Structured wellbeing crisis card — the shared format for the StudentAlert
 * summary raised by recordWellbeingConcern (src/lib/sage/crisis-detection.ts).
 *
 * StudentAlert has no JSON/metadata column and adding one is out of scope for
 * this safety fix, so the card is encoded as a stable, human-readable
 * plain-text block inside the alert's existing `summary` text field. This
 * module is the single source of truth for both sides:
 *   - the builder (formatWellbeingCardSummary) used by crisis-detection.ts
 *   - the parser (parseWellbeingCardSummary) used by teacher alert UIs
 * Keeping both in one dependency-light file (no prisma / server-only imports —
 * it is imported by client components) prevents format drift. Renderers that
 * show the raw summary still read it as sensible text.
 *
 * PRIVACY INVARIANT (locked product decision): teachers have NO transcript
 * access, and the card exists so a crisis alert is actionable without one. It
 * carries the trigger CATEGORY only — never any student message text.
 */

export type WellbeingTriggerCategory =
  | "self_harm"
  | "harm_others"
  | "abuse"
  | "low_mood";

/** Alert type raised by recordWellbeingConcern; shared with teacher UIs. */
export const WELLBEING_ALERT_TYPE = "wellbeing_concern";

/** How far back a MoodEntry may be and still appear on the crisis card. */
export const WELLBEING_MOOD_LOOKBACK_DAYS = 14;

export const WELLBEING_CATEGORY_LABELS: Record<WellbeingTriggerCategory, string> = {
  self_harm: "Self-harm language",
  harm_others: "Harm-to-others language",
  abuse: "Possible abuse disclosure",
  low_mood: "Very low mood score",
};

/** Shown when a message signal arrives without a category (defensive only). */
const FALLBACK_CATEGORY_LABEL = "Concerning language in chat";

/**
 * Static recommended-response checklist. Order matters: same-day human
 * contact first, escalation paths next, documentation last.
 */
export const WELLBEING_RESPONSE_CHECKLIST: readonly string[] = [
  "Reach the student today, in person or by phone.",
  "If there is immediate danger, call 911.",
  "Share the 988 Suicide & Crisis Lifeline (call or text 988).",
  "Document your outreach in case notes.",
];

const CARD_LEAD =
  "A student may have shared something serious in a Sage conversation. " +
  "No message text is stored for privacy — review the crisis card and reach out to the student directly.";

const SIGNAL_PREFIX = "Signal: ";
const DETECTED_PREFIX = "Detected: ";
const MOOD_PREFIX = "Recent mood: ";
const CHECKLIST_HEADING = "Recommended response:";

export interface WellbeingMoodSnapshot {
  /** Self-reported 1-10 mood/motivation score. */
  score: number;
  recordedAt: Date;
}

export interface WellbeingCardInput {
  category: WellbeingTriggerCategory | null;
  detectedAt: Date;
  mood: WellbeingMoodSnapshot | null;
}

export function wellbeingCategoryLabel(category: WellbeingTriggerCategory | null): string {
  return category ? WELLBEING_CATEGORY_LABELS[category] : FALLBACK_CATEGORY_LABEL;
}

/** "2026-07-20 14:32 UTC" — deterministic, locale-free. */
function utcMinuteStamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "2026-07-12" — deterministic, locale-free. */
function utcDateStamp(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Build the plain-text crisis card stored in StudentAlert.summary. Contains
 * category, detection time, optional recent mood, and the static checklist —
 * and never any message text.
 */
export function formatWellbeingCardSummary(input: WellbeingCardInput): string {
  const lines = [
    CARD_LEAD,
    "",
    `${SIGNAL_PREFIX}${wellbeingCategoryLabel(input.category)}`,
    `${DETECTED_PREFIX}${utcMinuteStamp(input.detectedAt)}`,
  ];
  if (input.mood) {
    lines.push(`${MOOD_PREFIX}${input.mood.score}/10 (${utcDateStamp(input.mood.recordedAt)})`);
  }
  lines.push("", CHECKLIST_HEADING);
  WELLBEING_RESPONSE_CHECKLIST.forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  return lines.join("\n");
}

export interface ParsedWellbeingCard {
  lead: string;
  categoryLabel: string;
  detectedLabel: string;
  moodLabel: string | null;
  checklist: string[];
}

/**
 * Parse a StudentAlert.summary back into card fields for structured
 * rendering. Returns null for legacy / non-card summaries so callers can fall
 * back to showing the raw text.
 */
export function parseWellbeingCardSummary(summary: string): ParsedWellbeingCard | null {
  if (!summary || typeof summary !== "string") return null;
  const lines = summary.split("\n").map((line) => line.trim());

  const signalLine = lines.find((line) => line.startsWith(SIGNAL_PREFIX));
  const detectedLine = lines.find((line) => line.startsWith(DETECTED_PREFIX));
  if (!signalLine || !detectedLine) return null;

  const moodLine = lines.find((line) => line.startsWith(MOOD_PREFIX)) ?? null;

  const headingIndex = lines.indexOf(CHECKLIST_HEADING);
  const checklist =
    headingIndex === -1
      ? []
      : lines
          .slice(headingIndex + 1)
          .filter((line) => /^\d+\.\s/.test(line))
          .map((line) => line.replace(/^\d+\.\s*/, ""));
  if (checklist.length === 0) return null;

  return {
    lead: lines[0] ?? "",
    categoryLabel: signalLine.slice(SIGNAL_PREFIX.length),
    detectedLabel: detectedLine.slice(DETECTED_PREFIX.length),
    moodLabel: moodLine ? moodLine.slice(MOOD_PREFIX.length) : null,
    checklist,
  };
}

/**
 * One-line rendering for compact queue rows (intervention queue, grouped
 * alert lists). Returns null when the summary is not a structured card so
 * callers can fall back to the raw text.
 */
export function formatWellbeingQueueLine(summary: string): string | null {
  const card = parseWellbeingCardSummary(summary);
  if (!card) return null;
  const mood = card.moodLabel ? ` · Mood ${card.moodLabel}` : "";
  return `${card.categoryLabel}${mood} — review the crisis card and reach out directly.`;
}
