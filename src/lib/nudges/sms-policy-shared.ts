// =============================================================================
// SMS send policy — the Prisma-free half.
//
// Match & Connect Phase 5, Task 5.1 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; design spec §10: "SMS requires recorded
// consent, respects quiet hours, is logged, and every message names SPOKES").
//
// Everything here is a pure function of a preference snapshot, a clock, and a
// count, so the four rules that decide whether a text may leave the program
// can be tested exhaustively without a database:
//
//   1. consent — recorded, not revoked, channel on, number present;
//   2. quiet hours — nothing between 21:00 and 08:00 America/New_York;
//   3. a per-recipient cap of two messages per local day;
//   4. every body names SPOKES, carries the opt-out line, and fits one
//      160-character segment.
//
// The zone is fixed rather than per-student because SPOKES is a West Virginia
// program with one classroom timezone, and a wrong guess here is a text at
// 3 a.m. `Intl.DateTimeFormat` does the offset arithmetic, so DST is the
// platform's problem and not a table of dates that goes stale.
//
// This module must never import @/lib/db: the settings page renders the
// consent copy from here.
// =============================================================================

/** SPOKES is in West Virginia. One program, one clock. */
export const SMS_TIME_ZONE = "America/New_York";

/** No text goes out at or after this local hour. */
export const QUIET_HOURS_START_HOUR = 21;
/** The first local hour a text may go out again. */
export const QUIET_HOURS_END_HOUR = 8;

/**
 * Messages per recipient per local day, across every template.
 *
 * Two, not "one per rule": the rules are independent (a retention check-in and
 * an interview confirmation can legitimately fall on the same Tuesday) but the
 * person receiving them is not, and a program that texts an adult learner four
 * times in a day is a program they mute. The consent copy on the settings page
 * quotes this number, so changing it means changing that sentence too.
 */
export const SMS_DAILY_CAP = 2;

/** One GSM-7 segment. A longer body silently becomes two paid messages. */
export const SMS_MAX_LENGTH = 160;

/** Every body opens with this, so a stranger's text is never anonymous. */
export const SMS_PREFIX = "SPOKES:";

/** Every body closes with this. Twilio also honours STOP on its own. */
export const SMS_STOP_SUFFIX = "Reply STOP to stop.";

/**
 * Consent copy for the settings page, kept here rather than inline in the
 * component so the frequency claim and SMS_DAILY_CAP cannot drift apart.
 * Grade-6 wording: short sentences, plain words, no conditionals.
 */
export const SMS_CONSENT_HEADING = "Get text reminders from SPOKES";
export const SMS_CONSENT_POINTS = [
  "SPOKES will text you about jobs, interviews, and check-ins.",
  `We send up to ${SMS_DAILY_CAP} texts a day. Most weeks you get 1.`,
  "We never text between 9pm and 8am.",
  "Text STOP any time to stop. Text START to turn them back on.",
  "Texts are not required. You can use SPOKES without them.",
  "Your phone plan may charge you for texts.",
] as const;
export const SMS_CONSENT_CHECKBOX_LABEL =
  "Yes, SPOKES can text me at this number. I can text STOP to stop.";

export interface SmsPreferenceSnapshot {
  enabled: boolean;
  destination: string | null;
  smsConsentAt: Date | null;
  smsRevokedAt: Date | null;
}

/**
 * Stable codes. A refusal is permanent until something changes about the
 * recipient; a deferral is this run's timing and will clear on its own.
 */
export const SMS_REFUSAL = {
  noPreference: "no_preference",
  noDestination: "no_phone_number",
  disabled: "channel_disabled",
  noConsent: "no_consent",
  revoked: "consent_revoked",
  quietHours: "quiet_hours",
  dailyCap: "daily_cap",
} as const;

export type SmsRefusalReason = (typeof SMS_REFUSAL)[keyof typeof SMS_REFUSAL];

export type SmsDecision =
  | { decision: "allow" }
  | { decision: "defer"; until: Date; reason: SmsRefusalReason }
  | { decision: "refuse"; reason: SmsRefusalReason };

// ---------------------------------------------------------------------------
// Local time, without a timezone library
// ---------------------------------------------------------------------------

const ZONED_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SMS_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(at: Date): ZonedParts {
  const found: Record<string, string> = {};
  for (const part of ZONED_PARTS.formatToParts(at)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // `hour12: false` renders midnight as "24" in some ICU versions.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

/** The wall-clock hour in America/New_York, 0-23. */
export function zonedHour(at: Date): number {
  return partsOf(at).hour;
}

/** The local calendar day as "YYYY-MM-DD" — the daily cap's window key. */
export function zonedDayKey(at: Date): string {
  const { year, month, day } = partsOf(at);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The UTC instant whose America/New_York wall clock is the given local time.
 *
 * Two passes: the first guess treats the wall clock as UTC and measures how far
 * off that is, the second re-measures at the corrected instant. The second pass
 * is what makes a DST day right — the offset on 2026-03-08 at 00:00 local
 * (-05:00) is not the offset at 08:00 local (-04:00), so a single pass would
 * land an hour out on exactly the two days a year this matters.
 */
function fromZonedWallClock(local: {
  year: number;
  month: number;
  day: number;
  hour: number;
}): Date {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, 0, 0, 0);
  const offsetAt = (instant: number) => {
    const p = partsOf(new Date(instant));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
  };
  const firstGuess = naive - offsetAt(naive);
  return new Date(naive - offsetAt(firstGuess));
}

export function isQuietHour(at: Date): boolean {
  const hour = zonedHour(at);
  return hour >= QUIET_HOURS_START_HOUR || hour < QUIET_HOURS_END_HOUR;
}

/**
 * The next instant a message may go out: today at 08:00 local when the clock
 * has not reached it yet, otherwise tomorrow at 08:00 local.
 *
 * Note the shape of the late-evening case: at 22:00 on the 30th, "today's"
 * window has already closed, so the answer is the 31st. The local day is
 * advanced by adding a day to the local Y/M/D — never by adding 24 hours to
 * the UTC instant, which would be an hour out across a DST change.
 */
export function nextSendWindowStart(at: Date): Date {
  const parts = partsOf(at);
  if (parts.hour < QUIET_HOURS_END_HOUR) {
    return fromZonedWallClock({ ...parts, hour: QUIET_HOURS_END_HOUR });
  }
  const nextLocalDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return fromZonedWallClock({
    year: nextLocalDay.getUTCFullYear(),
    month: nextLocalDay.getUTCMonth() + 1,
    day: nextLocalDay.getUTCDate(),
    hour: QUIET_HOURS_END_HOUR,
  });
}

/** The start of the NEXT local day's send window, whatever hour it is now. */
function nextDaySendWindowStart(at: Date): Date {
  const parts = partsOf(at);
  const nextLocalDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return fromZonedWallClock({
    year: nextLocalDay.getUTCFullYear(),
    month: nextLocalDay.getUTCMonth() + 1,
    day: nextLocalDay.getUTCDate(),
    hour: QUIET_HOURS_END_HOUR,
  });
}

/** Is `at` a Monday in America/New_York? The weekly nudge's day gate. */
export function isZonedMonday(at: Date): boolean {
  const { year, month, day } = partsOf(at);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * May this recipient be texted right now?
 *
 * Consent is evaluated before timing on purpose: "we would have texted you at
 * 8am tomorrow, but you never agreed" is not a deferral, it is a refusal, and
 * a caller that retried a deferral would otherwise loop on it forever.
 */
export function canSendSms({
  pref,
  now,
  sentTodayCount,
}: {
  pref: SmsPreferenceSnapshot | null;
  now: Date;
  sentTodayCount: number;
}): SmsDecision {
  if (!pref) return { decision: "refuse", reason: SMS_REFUSAL.noPreference };
  if (!pref.destination) return { decision: "refuse", reason: SMS_REFUSAL.noDestination };
  if (!pref.enabled) return { decision: "refuse", reason: SMS_REFUSAL.disabled };
  if (!pref.smsConsentAt) return { decision: "refuse", reason: SMS_REFUSAL.noConsent };
  if (pref.smsRevokedAt) return { decision: "refuse", reason: SMS_REFUSAL.revoked };

  const deferrals: Array<{ until: Date; reason: SmsRefusalReason }> = [];
  if (sentTodayCount >= SMS_DAILY_CAP) {
    deferrals.push({ until: nextDaySendWindowStart(now), reason: SMS_REFUSAL.dailyCap });
  }
  if (isQuietHour(now)) {
    deferrals.push({ until: nextSendWindowStart(now), reason: SMS_REFUSAL.quietHours });
  }
  if (deferrals.length === 0) return { decision: "allow" };

  // The latest constraint is the binding one; reporting an earlier time would
  // send a caller back before it could actually send.
  const latest = deferrals.reduce((a, b) => (b.until.getTime() > a.until.getTime() ? b : a));
  return { decision: "defer", until: latest.until, reason: latest.reason };
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export class SmsBodyTooLongError extends Error {
  constructor(length: number) {
    super(`An SMS body must fit ${SMS_MAX_LENGTH} characters; this one is ${length}.`);
    this.name = "SmsBodyTooLongError";
  }
}

/** `SPOKES: <core> Reply STOP to stop.`, or a throw if that will not fit. */
export function composeSmsBody(core: string): string {
  const body = `${SMS_PREFIX} ${core.trim()} ${SMS_STOP_SUFFIX}`;
  if (body.length > SMS_MAX_LENGTH) throw new SmsBodyTooLongError(body.length);
  return body;
}

/**
 * Compose a body with one caller-supplied value in it, trimming that value —
 * and only that value — until the whole thing fits.
 *
 * The budget is measured by rendering with an empty value first, so the
 * template's own words are never what gets cut. An employer legal name can be
 * sixty characters; the sentence around it must survive intact or the message
 * stops making sense.
 */
export function composeSmsBodyWith(render: (value: string) => string, value: string): string {
  const fixedLength = composeSmsBody(render("")).length;
  const budget = SMS_MAX_LENGTH - fixedLength;
  const clean = value.trim().replace(/\s+/g, " ");
  const fitted =
    clean.length <= budget ? clean : `${clean.slice(0, Math.max(0, budget - 1)).trimEnd()}…`;
  return composeSmsBody(render(fitted));
}

export function buildWeeklyJobsSms(count: number): string {
  return composeSmsBody(`${count} new jobs near you this week. Reply Y and Sage will show them.`);
}

export function buildInterviewConfirmSms(input: {
  employerName: string;
  when: string;
}): string {
  // The time is fixed text and the employer name is the elastic part: a
  // student who cannot read the day and hour has been sent nothing useful.
  return composeSmsBodyWith(
    (employer) => `Your interview with ${employer} is ${input.when}. Reply Y to confirm.`,
    input.employerName,
  );
}

export function buildHeardBackSms(jobTitle: string): string {
  return composeSmsBodyWith(
    (title) => `Did you hear back about the ${title} job? Reply Y or N.`,
    jobTitle,
  );
}

export function buildRetentionSms(employerName: string): string {
  return composeSmsBodyWith((employer) => `Still working at ${employer}? Reply Y or N.`, employerName);
}

/**
 * The general notification text (daily coaching prompts and reminders).
 *
 * The link is dropped rather than the title when the two cannot both fit: a
 * text that says only "SPOKES: … visionquest.onrender.com" tells the reader
 * nothing about why they were interrupted.
 */
export function buildNotificationSms(title: string, actionUrl: string): string {
  try {
    return composeSmsBodyWith((text) => `${text} ${actionUrl}`, title);
  } catch {
    return composeSmsBodyWith((text) => text, title);
  }
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export type InboundSmsIntent = "stop" | "start" | "yes" | "no" | "unknown";

const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "YES"]);

/**
 * What a reply means, on an exact-keyword basis.
 *
 * Deliberately exact rather than "contains STOP": "stop texting me about the
 * job" is a person talking, and treating a sentence as an opt-out would drop
 * them from the programme's reminders on the strength of a substring. Twilio's
 * own STOP handling is also exact, so a looser rule here would disagree with
 * the carrier-level state and produce a preference row that says one thing
 * while the carrier says another.
 */
export function classifyInboundSms(raw: string): InboundSmsIntent {
  const word = raw.trim().replace(/[.!,?]+$/, "").toUpperCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (word === "Y") return "yes";
  if (word === "N") return "no";
  return "unknown";
}

/**
 * Replace any URL in a message body with `[link]`.
 *
 * Bodies are stored in OutboundMessage, which staff read. A link in one of
 * these carries a token or a student-scoped path; the audit trail needs to
 * know a link was sent, never which one.
 */
export function redactLinks(body: string): string {
  return body
    .replace(/\bhttps?:\/\/\S+/gi, "[link]")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi, "[link]");
}
