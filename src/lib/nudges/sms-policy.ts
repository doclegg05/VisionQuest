// =============================================================================
// SMS send policy — the Prisma half.
//
// One function sends a text, and it is the only one: it loads the recipient's
// consent record, counts what they have already had today, asks the pure
// policy in ./sms-policy-shared.ts, and writes the OutboundMessage row beside
// the send. A text sent any other way has no consent check and no log line,
// and the log is what the design spec asks for ("SMS ... is logged").
//
// --- Why prismaAdmin, and how it is bounded ---
// OutboundMessage's RLS policy is staff-only (admin/teacher) because the log
// names the employer contact, and NotificationPreference reads here happen
// from the nudge sweep, which has no session at all. Neither can be reached
// with the app client. Every admin read and write in this module is therefore
// bounded by shape rather than by call-site provenance: the preference lookup
// is always `channel: "sms"` for one named student, and the log write is
// always `toKind: "student"` with that same id. There is no path through this
// module that touches another student's row.
// =============================================================================

import { prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { redactContactInfo } from "@/lib/log-redaction";
import { sendSms } from "@/lib/sms";

import {
  ADVISORY_LOCK_CLASS,
  SMS_MAX_LENGTH,
  SMS_PREFIX,
  SMS_STOP_SUFFIX,
  canSendSms,
  redactLinks,
  zonedDayKey,
  type SmsPreferenceSnapshot,
  type SmsRefusalReason,
} from "./sms-policy-shared";

export * from "./sms-policy-shared";

export type SmsSendResult =
  | { status: "sent"; outboundMessageId: string }
  | { status: "failed"; outboundMessageId: string }
  | { status: "would_send" }
  | { status: "deferred"; reason: SmsRefusalReason; until: Date }
  | { status: "refused"; reason: SmsRefusalReason | "malformed_body" | "send_error" };

/** The student's SMS preference row, or null when they have never set one. */
export async function loadSmsPreference(
  studentId: string,
): Promise<SmsPreferenceSnapshot | null> {
  const row = await prismaAdmin.notificationPreference.findFirst({
    where: { studentId, channel: "sms" },
    select: {
      enabled: true,
      destination: true,
      smsConsentAt: true,
      smsRevokedAt: true,
    },
  });
  return row ?? null;
}

/**
 * The local-day boundaries the cap is counted over, as UTC instants.
 *
 * A rolling 24-hour window would let a student who got two texts at 8pm be
 * silent until 8pm the next day; the cap people actually experience is "how
 * many did I get today", so the window is the calendar day where they live.
 */
function localDayWindow(now: Date): { gte: Date; lt: Date } {
  const dayKey = zonedDayKey(now);
  const [year, month, day] = dayKey.split("-").map(Number);
  // Midnight local is derived from the same helper the rest of the module
  // uses, by asking what instant has that wall clock; 00:00 always exists in
  // America/New_York (the spring-forward gap is at 02:00).
  const startOfDay = localMidnight(year, month, day);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const startOfNextDay = localMidnight(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
  return { gte: startOfDay, lt: startOfNextDay };
}

function localMidnight(year: number, month: number, day: number): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetAt = (instant: number) => {
    const local = new Date(instant).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const [datePart, timePart] = local.split(", ");
    const [m, d, y] = datePart.split("/").map(Number);
    const [h, min, s] = timePart.split(":").map(Number);
    return Date.UTC(y, m - 1, d, h % 24, min, s) - instant;
  };
  const firstGuess = naive - offsetAt(naive);
  return new Date(naive - offsetAt(firstGuess));
}

/**
 * Statuses that consume the daily cap.
 *
 * `failed` counts: the attempt reached Twilio and was billed, and a number
 * that fails is usually a number that will fail again — letting failures run
 * free turns a bad number into an unbounded hourly retry loop with a bill
 * attached. `queued` counts because it is a reservation held by a concurrent
 * send that has not reported back yet; that is what makes the cap safe under
 * two overlapping runs.
 */
const CAP_CONSUMING_STATUSES = ["sent", "queued", "failed"];

/** How many texts this recipient has already had in their own local day. */
export async function countSmsSentToday(
  studentId: string,
  now: Date,
  client: Pick<typeof prismaAdmin, "outboundMessage"> = prismaAdmin,
): Promise<number> {
  const window = localDayWindow(now);
  return client.outboundMessage.count({
    where: {
      channel: "sms",
      toKind: "student",
      toId: studentId,
      status: { in: CAP_CONSUMING_STATUSES },
      sentAt: { gte: window.gte, lt: window.lt },
    },
  });
}

/**
 * Every body is checked against the same three shape rules the templates
 * already satisfy. A caller that hand-rolls a body — a future Sage tool, a
 * script — gets the same guarantee without having to remember it.
 */
function bodyIsWellFormed(body: string): boolean {
  return (
    body.startsWith(`${SMS_PREFIX} `) &&
    body.endsWith(SMS_STOP_SUFFIX) &&
    body.length <= SMS_MAX_LENGTH
  );
}

export interface SendPolicySmsInput {
  studentId: string;
  /** Stable key for the rule that sent this, e.g. "weekly_jobs", "retention_30". */
  templateKey: string;
  /** The finished body, from a builder in ./sms-policy-shared.ts. */
  body: string;
  connectionId?: string | null;
  /** The routing token a reply to this message will resolve against. */
  expectsReply?: string | null;
  now?: Date;
  /** Plan only: decide and report, touch neither Twilio nor the log. */
  dryRun?: boolean;
}

/**
 * Send one text, or explain why not.
 *
 * Never throws: this runs inside a sweep over many students, and one bad
 * recipient must not take the run down. A delivery failure still writes its
 * OutboundMessage row — with `status: "failed"` and no `expectsReply`, because
 * a question that never arrived must not sit waiting to consume the next "Y"
 * the student sends about something else.
 */
export async function sendPolicySms(input: SendPolicySmsInput): Promise<SmsSendResult> {
  // This runs inside a sweep over many students and inside a webhook that must
  // answer 200. Nothing it can do is worth taking either of those down, so the
  // whole body is guarded and every failure becomes a value.
  try {
    return await sendPolicySmsUnsafe(input);
  } catch (error) {
    logger.error("SMS send failed unexpectedly", {
      channel: "sms",
      templateKey: input.templateKey,
      student: studentLogKey(input.studentId),
      error: redactContactInfo(String(error)),
    });
    return { status: "refused", reason: "send_error" };
  }
}

/**
 * Reserve, send, record.
 *
 * The reservation is the point. The cap used to be a read-then-write — count
 * today's rows, decide, send, insert — so two overlapping runs (the hourly
 * cron and someone curling the route, or two Render instances) could both read
 * "1 sent today" and both send, putting three texts on one phone in a day the
 * policy caps at two. Now the count and the INSERT happen in one transaction
 * holding `pg_advisory_xact_lock(1, hashtext(studentId))`, so concurrent callers
 * for the same recipient serialise on that key, and the row they insert is a
 * `queued` reservation that counts against the cap immediately.
 *
 * The Twilio call stays OUTSIDE the transaction: holding a database
 * transaction open across a network call to a third party is how a pool gets
 * exhausted by one slow provider. The row is updated to `sent` or `failed`
 * afterwards. A crash between the two leaves a `queued` row, which counts
 * against the cap for the rest of that local day — the safe direction.
 */
async function sendPolicySmsUnsafe(input: SendPolicySmsInput): Promise<SmsSendResult> {
  const now = input.now ?? new Date();

  if (!bodyIsWellFormed(input.body)) {
    logger.error("Refusing a malformed SMS body", {
      templateKey: input.templateKey,
      length: input.body.length,
    });
    return { status: "refused", reason: "malformed_body" };
  }

  if (input.dryRun) {
    // A dry run must not reserve anything, so it asks the question outside the
    // lock and reports the answer it would have got.
    const pref = await loadSmsPreference(input.studentId);
    const decision = canSendSms({
      pref,
      now,
      sentTodayCount: await countSmsSentToday(input.studentId, now),
    });
    if (decision.decision === "refuse") return { status: "refused", reason: decision.reason };
    if (decision.decision === "defer") {
      return { status: "deferred", reason: decision.reason, until: decision.until };
    }
    return { status: "would_send" };
  }

  const reserved = await prismaAdmin.$transaction(async (tx) => {
    // Serialises every concurrent send to THIS recipient, and releases at
    // commit or rollback — no session-level lock to leak across a pooled
    // connection. hashtext() is stable within a database version, which is all
    // this needs: a collision between two students costs one serialised write.
    // The class id keeps this key in its own namespace, so it can never
    // collide with the run lock in ./schedule.ts (see ADVISORY_LOCK_CLASS).
    //
    // `::int` on the class id is load-bearing. Postgres has two overloads,
    // (bigint) and (int, int); Prisma binds a JavaScript number as bigint, so
    // the untyped two-argument form resolves to (bigint, integer), matches
    // neither, and raises 42883. `sendPolicySms` is total, so that became
    // `{ status: "refused", reason: "send_error" }` for every text the program
    // tried to send — a complete, silent outage of the SMS channel. Found by
    // the nudge-sweep benchmark against a real Postgres; this module's unit
    // tests mock $executeRaw, so they cannot see it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASS.smsSend}::int, hashtext(${input.studentId}))`;

    // Consent is re-read inside the lock so a STOP that landed a millisecond
    // ago is honoured rather than raced.
    const pref = await tx.notificationPreference.findFirst({
      where: { studentId: input.studentId, channel: "sms" },
      select: { enabled: true, destination: true, smsConsentAt: true, smsRevokedAt: true },
    });
    const sentTodayCount = await countSmsSentToday(input.studentId, now, tx);
    const decision = canSendSms({ pref, now, sentTodayCount });
    if (decision.decision !== "allow") return { decision, row: null, destination: null };

    const row = await tx.outboundMessage.create({
      data: {
        channel: "sms",
        toKind: "student",
        toId: input.studentId,
        templateKey: input.templateKey,
        // The stored copy carries no link: staff read this table, and a link
        // in one of these messages is student-scoped or token-bearing.
        body: redactLinks(input.body),
        status: "queued",
        connectionId: input.connectionId ?? null,
        // Written only once delivery is confirmed: a question that never
        // arrived must not consume the next "Y" about something else.
        expectsReply: null,
        sentAt: now,
      },
      select: { id: true },
    });
    return { decision, row, destination: pref?.destination ?? null };
  });

  if (reserved.decision.decision === "refuse") {
    return { status: "refused", reason: reserved.decision.reason };
  }
  if (reserved.decision.decision === "defer") {
    return {
      status: "deferred",
      reason: reserved.decision.reason,
      until: reserved.decision.until,
    };
  }
  const { row, destination } = reserved;
  if (!row || !destination) return { status: "refused", reason: "no_phone_number" };

  const delivered = await sendSms(destination, input.body);

  await prismaAdmin.outboundMessage.update({
    where: { id: row.id },
    data: {
      status: delivered ? "sent" : "failed",
      expectsReply: delivered ? (input.expectsReply ?? null) : null,
    },
  });

  logger.info("Nudge SMS attempted", {
    channel: "sms",
    templateKey: input.templateKey,
    delivered,
    student: studentLogKey(input.studentId),
  });

  return delivered
    ? { status: "sent", outboundMessageId: row.id }
    : { status: "failed", outboundMessageId: row.id };
}
