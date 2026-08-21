// =============================================================================
// Recent activity — the "what happened since you last talked" prompt section.
//
// The context bundle (src/lib/sage/context-bundle.ts) fetches ProgressionEvents
// and alert descriptors on EVERY chat turn; until this section existed the
// send route paid for those queries and discarded them. renderRecentActivity()
// turns the already-fetched fields into a bounded prompt block so Sage can say
// "your cert was approved yesterday" instead of asking the student what
// happened. Closed-loop read plane: docs/plans/2026-04-29-sage-closed-loop.md.
//
// Pure and hard-bounded by construction: at most MAX_EVENT_LINES event lines
// and MAX_ALERT_LINES alert lines, each truncated to MAX_LINE_CHARS — small
// enough (~1KB worst case) that it ships on the compact/local tier too, where
// it is the only recency signal (the situational snapshot is full-tier-only).
//
// This text ships in the system prompt, so changes here are prompt changes:
// bump SAGE_PROMPT_REVISION (src/lib/sage/prompt-revision.ts) when the wording
// materially changes.
// =============================================================================

import { sanitizeForPrompt } from "./system-prompts";

export interface RecentActivityEvent {
  eventType: string;
  xp: number;
  occurredAt: Date;
}

export interface RecentActivityAlert {
  severity: string;
  title: string;
  summary: string;
}

export interface RecentActivityInput {
  /**
   * Most-recent-first, as the context bundle returns them. Optional because
   * this sits at the bundle seam: a partial bundle (mocked assembler, older
   * caller) must degrade to an empty block, never throw mid-turn.
   */
  events?: RecentActivityEvent[];
  alerts?: RecentActivityAlert[];
  /** Injectable for tests; defaults to the wall clock. */
  now?: Date;
}

const MAX_EVENT_LINES = 5;
const MAX_ALERT_LINES = 3;
const MAX_LINE_CHARS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ambient events fire on nearly every visit (each chat turn logs a
 * chat_session) and would crowd the 5-line budget out of the events that
 * actually mean something to acknowledge — filtered BEFORE capping so a cert
 * earned last week still surfaces under a pile of daily chats.
 */
const AMBIENT_EVENT_TYPES = new Set([
  "chat_session",
  "platform_visit",
  "document_view",
  "readiness_check",
]);

/**
 * Plain-language labels for the event types the progression engine awards.
 * Fallback for unlisted types is the de-underscored raw type — readable
 * enough, and a new event type never breaks the section.
 */
const EVENT_LABELS: Record<string, string> = {
  cert_earned: "Earned a certification",
  cert_started: "Started a certification",
  form_approved: "Had a form approved",
  orientation_complete: "Completed orientation",
  orientation_welcome_video: "Watched the Sage welcome video",
  discovery_complete: "Finished career discovery",
  daily_checkin: "Did a daily check-in",
  portfolio_item: "Added a portfolio item",
  weekly_review: "Completed a weekly review",
  monthly_review: "Completed a monthly review",
};

export function humanizeEventType(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ");
}

/**
 * Calendar-day distance rendered the way Sage should speak it. Future
 * timestamps (clock skew) clamp to "today" rather than going negative.
 */
export function relativeDayLabel(occurredAt: Date, now: Date): string {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.max(
    0,
    Math.round((startOfDay(now) - startOfDay(occurredAt)) / DAY_MS),
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function truncateLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_LINE_CHARS
    ? `${collapsed.slice(0, MAX_LINE_CHARS - 1)}…`
    : collapsed;
}

/**
 * Render the bounded RECENT ACTIVITY block, or "" when there is nothing worth
 * saying — callers append unconditionally without a guard. The header doubles
 * as the instruction so the guidance travels with the data (situational-
 * snapshot precedent). Alert text is sanitized: titles/summaries are
 * system-authored today, but they summarize student-adjacent state and the
 * bracket-delimiter defense is cheap.
 */
export function renderRecentActivity(input: RecentActivityInput): string {
  const now = input.now ?? new Date();
  const events = (input.events ?? [])
    .filter((event) => !AMBIENT_EVENT_TYPES.has(event.eventType))
    .slice(0, MAX_EVENT_LINES);
  const alerts = (input.alerts ?? []).slice(0, MAX_ALERT_LINES);
  if (events.length === 0 && alerts.length === 0) return "";

  const lines: string[] = [
    "RECENT ACTIVITY — real platform events since you last talked (most recent first; treat as factual):",
  ];
  for (const event of events) {
    const xpSuffix = event.xp > 0 ? ` (+${event.xp} XP)` : "";
    lines.push(
      truncateLine(
        `- ${relativeDayLabel(event.occurredAt, now)}: ${humanizeEventType(event.eventType)}${xpSuffix}`,
      ),
    );
  }
  if (events.length === 0) {
    lines.push("- (no notable events recently)");
  }
  if (alerts.length > 0) {
    lines.push("ACTIVE ALERTS on this student's record:");
    for (const alert of alerts) {
      lines.push(
        truncateLine(
          `- [${sanitizeForPrompt(alert.severity)}] ${sanitizeForPrompt(alert.title)}: ${sanitizeForPrompt(alert.summary)}`,
        ),
      );
    }
  }
  lines.push(
    "Acknowledge what actually happened — congratulate real wins and pick up where they left off. " +
      "Mention only activity shown here; if something is not listed (like an approval they ask about), " +
      "say you don't see it yet instead of guessing.",
  );
  return lines.join("\n");
}
