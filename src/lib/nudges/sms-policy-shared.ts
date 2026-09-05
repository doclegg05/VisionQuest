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

/**
 * Advisory-lock class ids, one namespace per lock.
 *
 * Postgres advisory locks are one flat keyspace, so a bare
 * `hashtext(<string>)` from two unrelated locks can collide and one feature
 * would silently block the other. The two-argument form takes a class id
 * first, which separates the namespaces by construction:
 *
 *   smsSend  (1) — per-recipient, held while the daily-cap slot is reserved
 *                  (src/lib/nudges/sms-policy.ts)
 *   nudgeRun (2) — deployment-wide, held for one sweep of the hourly runner
 *                  (src/lib/nudges/schedule.ts)
 *
 * Both are TRANSACTION-scoped (`pg_advisory_xact_lock` /
 * `pg_try_advisory_xact_lock`). A session-scoped lock is bound to whichever
 * pooled backend answered and its release is a separate query that may land on
 * a different one, which leaks the lock permanently; the transaction form is
 * released by commit or rollback on the connection that holds it, so there is
 * nothing to leak and no unlock statement to get lost.
 */
export const ADVISORY_LOCK_CLASS = {
  smsSend: 1,
  nudgeRun: 2,
} as const;

/**
 * One GSM-7 segment. A longer body silently becomes two paid messages.
 *
 * GSM-7 is also why every template below is plain ASCII, including the
 * truncation marker: a single non-GSM character (a curly quote, an en dash, a
 * "…") switches the whole message to UCS-2, which cuts the segment to 70
 * characters — so a 100-character body that "fits" here would arrive as two
 * messages, or truncated, depending on the carrier. Keep new copy to ASCII.
 */
export const SMS_MAX_LENGTH = 160;

/** ASCII, for the reason above. Never "…". */
const TRUNCATION_MARKER = "...";

/**
 * The comparable form of a phone number: bare national digits.
 *
 * "+1 304 555 0123", "(304) 555-0123" and "3045550123" are one number, and a
 * raw string comparison calls each of them a different one. Anywhere that asks
 * "is this a NEW number?" has to normalise both sides or it answers yes to a
 * re-typed identical number -- which, on the settings page, wipes the
 * student's confirmed consent and makes them verify again for nothing.
 *
 * It lives in this module rather than beside the inbound matcher in replies.ts
 * because it is pure and client-safe, and replies.ts imports Prisma.
 */
export function normalizedPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

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

/**
 * Shown to someone whose SMS channel is ON but who has no consent on file —
 * every account that opted in before consent was recorded. There is no
 * backfill: a checkbox nobody ticked is not consent, so those students are
 * asked once and texts stop until they answer.
 */
export const SMS_CONSENT_CONFIRM_HEADING = "Confirm to keep getting texts";
export const SMS_CONSENT_CONFIRM_NOTICE =
  "You had texts turned on before. We need you to say yes one more time. " +
  "Until you do, SPOKES will not text you.";

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
/**
 * The GSM-7 basic set (plus the escape-table characters carriers accept as one
 * or two septets). Anything outside it flips the whole message to UCS-2, which
 * halves the segment to 70 characters — so an employer name copied out of a
 * job feed with a curly apostrophe would silently truncate or split the text.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  "\n\r^{}\\[~]|€";
const GSM7_SET = new Set(GSM7_BASIC.split(""));

/** Look-alikes worth keeping rather than dropping. */
const GSM7_TRANSLITERATIONS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "−": "-",
  "…": "...",
  " ": " ",
  "•": "-",
};

/**
 * Make a third-party string safe to put inside a message we sign our name to.
 *
 * Employer names, job titles and appointment labels reach here from job feeds
 * and from whatever an instructor typed. Five things have to go:
 *
 *   1. C0/C1 controls, including NUL and ESC — a newline lets a value forge
 *      what looks like a second, separate message inside one body;
 *   2. bidi overrides (U+202A-202E, U+2066-2069), which can visually reverse
 *      the text so the STOP line reads as something else;
 *   3. zero-width characters, which hide content from a reviewer but not from
 *      the recipient;
 *   4. our own control phrases — a title containing "SPOKES:" or "Reply STOP"
 *      lets a feed impersonate the program's framing inside its own message;
 *   5. anything outside GSM-7, which would double the cost and halve the room.
 */
export function sanitizeSmsValue(value: string): string {
  const withoutControls = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "");

  const transliterated = Array.from(withoutControls)
    .map((char) => {
      if (GSM7_SET.has(char)) return char;
      const replacement = GSM7_TRANSLITERATIONS[char];
      if (replacement !== undefined) return replacement;
      // Unknown and un-encodable: a space, not a drop, so two words do not
      // fuse into one when an emoji sat between them.
      return " ";
    })
    .join("");

  return transliterated
    .replace(/SPOKES\s*:/gi, "SPOKES")
    .replace(/reply\s+stop/gi, "reply")
    .replace(/\s+/g, " ")
    .trim();
}

export function composeSmsBodyWith(render: (value: string) => string, value: string): string {
  const fixedLength = composeSmsBody(render("")).length;
  const budget = SMS_MAX_LENGTH - fixedLength;
  const clean = sanitizeSmsValue(value);
  const fitted =
    clean.length <= budget
      ? clean
      : `${clean.slice(0, Math.max(0, budget - TRUNCATION_MARKER.length)).trimEnd()}${TRUNCATION_MARKER}`;
  return composeSmsBody(render(fitted));
}

/**
 * "1 new job" / "4 new jobs". A program that texts an adult learner "1 new
 * jobs" has told them, in three words, how much care went into the rest of it.
 */
export function buildWeeklyJobsSms(count: number): string {
  const noun = count === 1 ? "new job" : "new jobs";
  return composeSmsBody(
    `${count} ${noun} near you this week. Reply Y to see them on your Career page.`,
  );
}

/**
 * The interview reminder.
 *
 * It deliberately does NOT try to carry the address: no student page shows one
 * today, `Appointment.locationLabel` is free text that routinely does not fit a
 * segment, and a text that names a wrong or truncated place is worse than one
 * that names none. So it says where to get the address instead, which is a
 * thing the student can act on. When the appointment DOES carry a location,
 * `place` is the short label and the copy points at the appointments page,
 * which now renders these.
 */
export function buildInterviewConfirmSms(input: {
  employerName: string;
  when: string;
  place?: string | null;
}): string {
  const tail = input.place
    ? `See where on your SPOKES appointments page.`
    : `Ask your teacher for the address.`;
  // The time and the tail are fixed text and the employer name is the elastic
  // part: a student who cannot read the day and hour has been sent nothing.
  return composeSmsBodyWith(
    (employer) => `Interview with ${employer}, ${input.when}. ${tail} Reply Y to confirm.`,
    input.employerName,
  );
}

/** The ack after an interview "N". Sent through the policy, never inline. */
export function buildInterviewDeclineAckSms(): string {
  return composeSmsBody("Got it. Your teacher will call you.");
}

/**
 * "Got an interview?" rather than "did you hear back?": Y moves the saved job
 * to `interviewing`, and the old wording asked a broader question than the
 * answer records — a student who heard "no thanks" would also have said Y.
 */
export function buildHeardBackSms(jobTitle: string): string {
  return composeSmsBodyWith(
    (title) => `Got an interview for the ${title} job? Reply Y or N.`,
    jobTitle,
  );
}

/** Says what "N" actually does, now that it raises a staff alert. */
export function buildRetentionSms(employerName: string): string {
  return composeSmsBodyWith(
    (employer) => `Still working at ${employer}? Reply Y or N. If no, your coach will reach out.`,
    employerName,
  );
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
const YES_WORDS = new Set(["Y", "YES", "YEAH", "YEP"]);
const NO_WORDS = new Set(["N", "NO", "NOPE"]);

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
export function classifyInboundSms(
  raw: string,
  context: { hasPendingQuestion?: boolean } = {},
): InboundSmsIntent {
  const word = raw.trim().replace(/[.!,?]+$/, "").toUpperCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (word === "START") return "start";

  // "NO" and "N" are the same answer to a person, and treating "NO" as
  // unknown silently discarded the very answer the retention question exists
  // to capture — the one that opens a staff alert.
  if (NO_WORDS.has(word)) return "no";

  // "YES" is ambiguous by design: Twilio treats it as an opt-in keyword, and a
  // student answering "Still working at X?" also types it. Context decides —
  // an open question wins, because someone with a question in front of them is
  // answering it, and someone with none is restarting the channel.
  if (YES_WORDS.has(word)) {
    if (word === "Y") return "yes";
    return context.hasPendingQuestion ? "yes" : "start";
  }

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
  return (
    body
      .replace(/\bhttps?:\/\/\S+/gi, "[link]")
      // With a path…
      .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi, "[link]")
      // …and without one. A bare "visionquest.onrender.com" is still a link a
      // reader will follow, and the first cut left it in the stored body.
      // The TLD list is deliberate: matching any dotted token would eat
      // ordinary prose like "Reply Y or N." and employer names with initials.
      .replace(
        /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|co|us)\b/gi,
        "[link]",
      )
  );
}
