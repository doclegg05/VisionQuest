// =============================================================================
// The nudge schedule — the Prisma-free half.
//
// Match & Connect Phase 5, Task 5.2. Six rules decide who hears from the
// program and when; every one of them is a pure function of rows the runner
// has already fetched plus a clock, so "does this fire on day 29?" is a unit
// test rather than a database and a wait.
//
// The rules, and the shape of each:
//
//   employer no view (3 days)      -> instructor alert
//   employer no response (7 days)  -> instructor alert saying to CONSIDER
//                                     re-sending; nothing is ever re-sent
//                                     automatically (design spec §6 step 5)
//   interview confirmation (<24h)  -> one text to the student
//   "did you hear back?" (7 days)  -> one text to the student
//   retention 30 / 60 / 90         -> one text to the student per checkpoint
//   weekly jobs (Mon 10:00 ET)     -> one text to the student
//
// The asymmetry is deliberate and is the product decision, not an oversight:
// the EMPLOYER is never messaged by a machine. An employer who has not looked
// at a packet gets a person calling them, so the employer rules produce alerts
// and the student rules produce texts.
//
// This module must never import @/lib/db.
// =============================================================================

import {
  buildHeardBackSms,
  buildInterviewConfirmSms,
  buildInterviewDeclineAckSms,
  buildRetentionSms,
  buildWeeklyJobsSms,
  zonedHour,
  isZonedMonday,
} from "./sms-policy-shared";

import type { ConnectionStatus } from "@/lib/connect/pipeline-shared";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const EMPLOYER_NO_VIEW_DAYS = 3;
export const EMPLOYER_NO_RESPONSE_DAYS = 7;
export const INTERVIEW_LOOKAHEAD_HOURS = 24;
export const HEARD_BACK_DAYS = 7;
export const RETENTION_DAYS = [30, 60, 90] as const;
export type RetentionDay = (typeof RETENTION_DAYS)[number];

/** How long to wait before asking an unanswered retention question again. */
export const RETENTION_REASK_DAYS = 7;

/**
 * How many times one checkpoint is asked before the program stops texting and
 * asks a person instead. Two: a single unanswered text is a bad week, two is a
 * signal, and a third would be the program nagging someone who may have lost
 * the job and does not want to say so by SMS.
 */
export const RETENTION_MAX_ASKS = 2;

/**
 * A send that FAILED is not retried inside this window.
 *
 * A failure usually means a bad number or a Twilio problem, and neither is
 * fixed by trying again ten minutes later — but both are worth one retry a day
 * in case it was transient.
 */
export const FAILED_SEND_BACKOFF_HOURS = 24;

/** Monday morning, after the school run and before the day gets away. */
export const WEEKLY_NUDGE_HOUR_ET = 10;
export const WEEKLY_NUDGE_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Alert types this module raises. Three are staff-only and are NOT in
 * STUDENT_VISIBLE_ALERT_TYPES; `weeklyJobsReady` is the one the student asked
 * for by replying Y, and it is in that allowlist.
 */
export const NUDGE_ALERT_TYPES = {
  employerNoView: "connect_employer_no_view",
  employerNoResponse: "connect_employer_no_response",
  interviewUnconfirmed: "connect_interview_unconfirmed",
  /**
   * "The student says they are still working; record the SPOKES follow-up if
   * you can confirm it."
   *
   * This alert exists because a text is not evidence. `SpokesEmploymentFollowUp`
   * is the grant-official record — its canonical checkpoints are 1, 3 and 6
   * MONTHS after `SpokesRecord.unsubsidizedEmploymentAt`
   * (getEmploymentFollowUpSchedule), and grant-kpi.ts reads months 3 and 6 as
   * the WIOA/DoHS retention metric. The Connect funnel counts 30/60/90 DAYS
   * from `Connection.startedAt`, a different anchor entirely. Writing one from
   * the other would overwrite a teacher's row on a shared unique key, report a
   * self-reported "Y" as a verified outcome, and strand day 60 at a
   * checkpointMonths nothing reads. So the SMS answer moves the funnel and
   * asks a person to reconcile; it never touches the grant record.
   */
  retentionConfirm: "connect_retention_confirm",
  /**
   * Asked twice, no answer. The program stops texting that checkpoint and a
   * person picks up the phone — silence from a student who may have lost a job
   * is exactly the case where more automated texts are the wrong instrument.
   */
  retentionUnanswered: "connect_retention_unanswered",
  retentionLost: "connect_retention_lost",
  weeklyJobsReady: "connect_weekly_jobs_ready",
} as const;

export type NudgeAlertType = (typeof NUDGE_ALERT_TYPES)[keyof typeof NUDGE_ALERT_TYPES];

// ---------------------------------------------------------------------------
// Reply tokens
//
// An SMS reply is one character and the webhook knows only a phone number, so
// every question carries a token naming what it asked. Written on the outbound
// row, parsed on the way back in.
// ---------------------------------------------------------------------------

export type ReplyToken =
  | { kind: "weekly_jobs" }
  | { kind: "heard_back"; savedJobId: string }
  | { kind: "retention"; connectionId: string; day: RetentionDay }
  | { kind: "interview_confirm"; connectionId: string };

export function replyToken(token: ReplyToken): string {
  switch (token.kind) {
    case "weekly_jobs":
      return "weekly_jobs";
    case "heard_back":
      return `heard_back:${token.savedJobId}`;
    case "retention":
      return `retention:${token.connectionId}:${token.day}`;
    case "interview_confirm":
      return `interview_confirm:${token.connectionId}`;
  }
}

/** Null for anything this module did not write — an unknown token is ignored. */
export function parseReplyToken(raw: string | null | undefined): ReplyToken | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts[0] === "weekly_jobs" && parts.length === 1) return { kind: "weekly_jobs" };
  if (parts[0] === "heard_back" && parts.length === 2 && parts[1]) {
    return { kind: "heard_back", savedJobId: parts[1] };
  }
  if (parts[0] === "interview_confirm" && parts.length === 2 && parts[1]) {
    return { kind: "interview_confirm", connectionId: parts[1] };
  }
  if (parts[0] === "retention" && parts.length === 3 && parts[1]) {
    const day = Number(parts[2]);
    if ((RETENTION_DAYS as readonly number[]).includes(day)) {
      return { kind: "retention", connectionId: parts[1], day: day as RetentionDay };
    }
  }
  return null;
}

export function buildRetentionTemplateKey(day: RetentionDay): string {
  return `retention_${day}`;
}

/**
 * The acknowledgement after an interview "N", keyed per connection so the
 * runner's deferred-ack sweep can tell whether it has already gone out.
 */
export function interviewDeclineAckTemplateKey(connectionId: string): string {
  return `interview_decline_ack:${connectionId}`;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One row of the outbound log, as the rules need to see it.
 *
 * The templateKey alone is not enough, and assuming it was is what made the
 * retention chain stall: a lifetime "have we ever sent this?" check means an
 * unanswered day-30 text blocks day 30 forever, and because the status only
 * advances on a reply, days 60 and 90 are never reached either. The rules need
 * WHEN it was sent and WHETHER it arrived.
 */
export interface SentMessage {
  templateKey: string;
  sentAt: Date;
  /** queued | sent | failed. A failure is not an ask. */
  status: string;
}

export interface ConnectionSnapshot {
  id: string;
  studentId: string;
  employerName: string;
  jobTitle: string;
  status: ConnectionStatus;
  sentAt: Date | null;
  /** The most recent `employer_viewed` event, or null if the link is unopened. */
  lastViewAt: Date | null;
  /** The `started` transition's timestamp — retention counts from work, not hire. */
  startedAt: Date | null;
  interviewStartsAt: Date | null;
  /** So a rescheduled interview is a new reminder, not a suppressed duplicate. */
  interviewAppointmentId: string | null;
  interviewPlace: string | null;
  /** OutboundMessage rows already recorded against this connection. */
  sentMessages: SentMessage[];
  /** Open StudentAlert types already raised for it, so a rule fires once. */
  openAlertTypes: string[];
}

export interface SavedJobSnapshot {
  id: string;
  studentId: string;
  jobTitle: string;
  status: string;
  appliedAt: Date | null;
  /** A DELIVERED heard-back question already exists for this saved job. */
  alreadyAsked: boolean;
  /** A failed attempt is still inside its backoff window. */
  askFailedRecently: boolean;
}

export interface WeeklyCandidate {
  studentId: string;
  /** Open leads created in the last week that this student is not blocked from. */
  newLeadCount: number;
}

export interface NudgeAlertPlan {
  studentId: string;
  alertKey: string;
  type: NudgeAlertType;
  severity: "low" | "medium" | "high";
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
}

export interface NudgeSmsPlan {
  studentId: string;
  templateKey: string;
  body: string;
  /** null for an acknowledgement, which asks nothing and answers nothing. */
  expectsReply: string | null;
  connectionId?: string;
  savedJobId?: string;
  day?: RetentionDay;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/** Delivered asks of one template, newest first. A failure is not an ask. */
export function deliveredAsks(
  messages: readonly SentMessage[],
  templateKey: string,
): SentMessage[] {
  return messages
    .filter((message) => message.templateKey === templateKey && message.status === "sent")
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
}

/**
 * True while a FAILED send of this template is still inside its backoff.
 *
 * Separate from the delivered-ask check because the two answer different
 * questions: "have they been asked?" (no, it never arrived) and "should we try
 * again right now?" (not yet). Without this, a bad number is retried every
 * hour, forever, and every attempt is a Twilio charge.
 */
export function inFailureBackoff(
  messages: readonly SentMessage[],
  templateKey: string,
  now: Date,
): boolean {
  const cutoff = now.getTime() - FAILED_SEND_BACKOFF_HOURS * 60 * 60 * 1000;
  return messages.some(
    (message) =>
      message.templateKey === templateKey &&
      message.status === "failed" &&
      message.sentAt.getTime() >= cutoff,
  );
}

// ---------------------------------------------------------------------------
// Employer side — alerts only
// ---------------------------------------------------------------------------

/** Statuses where the employer has been sent something but has not answered. */
const AWAITING_EMPLOYER: readonly ConnectionStatus[] = ["sent", "viewed"];

export function selectEmployerNoView(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): NudgeAlertPlan[] {
  return connections
    .filter(
      (connection) =>
        connection.status === "sent" &&
        connection.lastViewAt === null &&
        connection.sentAt !== null &&
        daysBetween(connection.sentAt, now) >= EMPLOYER_NO_VIEW_DAYS &&
        !connection.openAlertTypes.includes(NUDGE_ALERT_TYPES.employerNoView),
    )
    .map((connection) => ({
      studentId: connection.studentId,
      alertKey: `${NUDGE_ALERT_TYPES.employerNoView}:${connection.id}`,
      type: NUDGE_ALERT_TYPES.employerNoView,
      severity: "medium" as const,
      title: `${connection.employerName} has not opened the packet`,
      summary:
        `The ${connection.jobTitle} packet was sent to ${connection.employerName} ` +
        `${EMPLOYER_NO_VIEW_DAYS} days ago and the link has not been opened. ` +
        `A phone call to the contact usually settles it faster than another email.`,
      sourceType: "connection",
      sourceId: connection.id,
    }));
}

export function selectEmployerNoResponse(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): NudgeAlertPlan[] {
  return connections
    .filter(
      (connection) =>
        AWAITING_EMPLOYER.includes(connection.status) &&
        connection.sentAt !== null &&
        daysBetween(connection.sentAt, now) >= EMPLOYER_NO_RESPONSE_DAYS &&
        !connection.openAlertTypes.includes(NUDGE_ALERT_TYPES.employerNoResponse) &&
        // "They have not opened it" and "they have not answered" are the same
        // card to an instructor with a phone in their hand. Stacking both on
        // one connection is two rows for one action.
        !connection.openAlertTypes.includes(NUDGE_ALERT_TYPES.employerNoView),
    )
    .map((connection) => ({
      studentId: connection.studentId,
      alertKey: `${NUDGE_ALERT_TYPES.employerNoResponse}:${connection.id}`,
      type: NUDGE_ALERT_TYPES.employerNoResponse,
      severity: "medium" as const,
      title: `No answer from ${connection.employerName} in ${EMPLOYER_NO_RESPONSE_DAYS} days`,
      summary:
        `${connection.employerName} has not answered about the ${connection.jobTitle} lead. ` +
        `You may want to consider re-sending it or calling the contact. ` +
        `Nothing goes back to an employer without a person deciding to send it.`,
      sourceType: "connection",
      sourceId: connection.id,
    }));
}

// ---------------------------------------------------------------------------
// Student side — texts
// ---------------------------------------------------------------------------

/**
 * Keyed on the APPOINTMENT, not the connection: an interview that is moved
 * gets a new appointment row, and a connection-keyed dedupe would suppress the
 * reminder for the new time because "we already sent one for this connection".
 */
export function interviewTemplateKey(appointmentId: string): string {
  return `interview_confirm:${appointmentId}`;
}

export function selectInterviewConfirmations(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): NudgeSmsPlan[] {
  const horizon = new Date(now.getTime() + INTERVIEW_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  return connections
    .filter((connection) => {
      if (connection.status !== "interview_scheduled") return false;
      if (!connection.interviewStartsAt || !connection.interviewAppointmentId) return false;
      if (connection.interviewStartsAt <= now) return false;
      if (connection.interviewStartsAt > horizon) return false;
      const key = interviewTemplateKey(connection.interviewAppointmentId);
      if (deliveredAsks(connection.sentMessages, key).length > 0) return false;
      return !inFailureBackoff(connection.sentMessages, key, now);
    })
    .map((connection) => ({
      studentId: connection.studentId,
      templateKey: interviewTemplateKey(connection.interviewAppointmentId as string),
      body: buildInterviewConfirmSms({
        employerName: connection.employerName,
        when: formatInterviewWhen(connection.interviewStartsAt as Date),
        place: connection.interviewPlace,
      }),
      expectsReply: replyToken({ kind: "interview_confirm", connectionId: connection.id }),
      connectionId: connection.id,
    }));
}

/**
 * "Tue 10:00 AM" in the program's timezone. Short because the whole message
 * has to fit one segment, and a date without a weekday is one more thing to
 * work out.
 */
export function formatInterviewWhen(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/**
 * The retention question the connection's CURRENT status is due for.
 *
 * Keyed off status rather than "every checkpoint whose day has passed": a
 * student who is 95 days in but has only ever answered the 30-day question is
 * asked the 60-day one next, because `retained_60` is the transition the
 * pipeline will accept. Asking all three at once would also blow the daily cap
 * and read as spam.
 */
const NEXT_RETENTION_DAY: Partial<Record<ConnectionStatus, RetentionDay>> = {
  started: 30,
  retained_30: 60,
  retained_60: 90,
};

/**
 * The retention question, and the point at which it stops being a question.
 *
 * The first cut suppressed a checkpoint for life once it had been sent. Since
 * the status only advances when the student REPLIES, an unanswered day-30 text
 * froze the whole chain: day 30 was never re-asked, and because the connection
 * stayed `started`, days 60 and 90 were never reached either. One ignored text
 * ended retention tracking for that placement permanently.
 *
 * So: ask, wait a week, ask once more, then stop and tell a person. The
 * connection does NOT advance on silence — an unanswered question is not a
 * recorded outcome, and `retained_30` has to mean somebody said so.
 */
export function selectRetentionChecks(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): { texts: NudgeSmsPlan[]; alerts: NudgeAlertPlan[] } {
  const texts: NudgeSmsPlan[] = [];
  const alerts: NudgeAlertPlan[] = [];

  for (const connection of connections) {
    const day = NEXT_RETENTION_DAY[connection.status];
    if (!day || !connection.startedAt) continue;
    if (daysBetween(connection.startedAt, now) < day) continue;

    const templateKey = buildRetentionTemplateKey(day);
    const asks = deliveredAsks(connection.sentMessages, templateKey);

    if (asks.length >= RETENTION_MAX_ASKS) {
      if (connection.openAlertTypes.includes(NUDGE_ALERT_TYPES.retentionUnanswered)) continue;
      alerts.push({
        studentId: connection.studentId,
        alertKey: `${NUDGE_ALERT_TYPES.retentionUnanswered}:${connection.id}:${day}`,
        type: NUDGE_ALERT_TYPES.retentionUnanswered,
        severity: "high",
        title: `No answer to the day-${day} check-in at ${connection.employerName}`,
        summary:
          `This student has not answered the day-${day} "still working?" text after ` +
          `${RETENTION_MAX_ASKS} tries. No more texts will go out for this checkpoint. ` +
          `Call them: silence here often means the job ended and they would rather not ` +
          `say so by text.`,
        sourceType: "connection",
        sourceId: connection.id,
      });
      continue;
    }

    // Asked recently and still waiting: leave them alone.
    const lastAsk = asks[0];
    if (lastAsk && daysBetween(lastAsk.sentAt, now) < RETENTION_REASK_DAYS) continue;
    if (inFailureBackoff(connection.sentMessages, templateKey, now)) continue;

    texts.push({
      studentId: connection.studentId,
      templateKey,
      body: buildRetentionSms(connection.employerName),
      expectsReply: replyToken({ kind: "retention", connectionId: connection.id, day }),
      connectionId: connection.id,
      day,
    });
  }

  return { texts, alerts };
}

/** Statuses that mean the student has already told us they heard something. */
const HEARD_BACK_PENDING_STATUS = "applied";

/** Carries the saved-job id, so a FAILED attempt is findable without a token. */
export function heardBackTemplateKey(savedJobId: string): string {
  return `heard_back:${savedJobId}`;
}

export function selectHeardBackChecks(
  savedJobs: readonly SavedJobSnapshot[],
  now: Date,
): NudgeSmsPlan[] {
  return savedJobs
    .filter(
      (job) =>
        job.status === HEARD_BACK_PENDING_STATUS &&
        job.appliedAt !== null &&
        daysBetween(job.appliedAt, now) >= HEARD_BACK_DAYS &&
        !job.alreadyAsked &&
        !job.askFailedRecently,
    )
    .map((job) => ({
      studentId: job.studentId,
      templateKey: heardBackTemplateKey(job.id),
      body: buildHeardBackSms(job.jobTitle),
      expectsReply: replyToken({ kind: "heard_back", savedJobId: job.id }),
      savedJobId: job.id,
    }));
}

/**
 * Acknowledgements that were deferred by quiet hours or the cap.
 *
 * The interview "N" ack is sent through the policy, so at 11pm it comes back
 * `deferred` and nothing goes out. Rather than a queue, the state is
 * re-derived: the open `connect_interview_unconfirmed` alert says an ack is
 * owed, and the absence of a delivered `interview_decline_ack:<id>` row says it
 * has not gone out yet. The next sweep inside the send window picks it up, and
 * nothing has to survive a restart.
 */
export function selectDeferredInterviewAcks(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): NudgeSmsPlan[] {
  return connections
    .filter((connection) => {
      if (!connection.openAlertTypes.includes(NUDGE_ALERT_TYPES.interviewUnconfirmed)) {
        return false;
      }
      const key = interviewDeclineAckTemplateKey(connection.id);
      if (deliveredAsks(connection.sentMessages, key).length > 0) return false;
      return !inFailureBackoff(connection.sentMessages, key, now);
    })
    .map((connection) => ({
      studentId: connection.studentId,
      templateKey: interviewDeclineAckTemplateKey(connection.id),
      body: buildInterviewDeclineAckSms(),
      // An acknowledgement asks nothing, so it must not become the question a
      // later "Y" answers.
      expectsReply: null,
      connectionId: connection.id,
    }));
}

/**
 * Monday, at or after 10:00 America/New_York.
 *
 * `=== 10` would mean a single missed cron slot — a deploy, a database blip, a
 * pg_net timeout — silently skipped the whole class for a week. The per-student
 * six-day dedupe in the runner is what stops repeats, so widening the window
 * costs nothing and buys the run eleven more chances to succeed.
 */
export function isWeeklyNudgeSlot(now: Date): boolean {
  return isZonedMonday(now) && zonedHour(now) >= WEEKLY_NUDGE_HOUR_ET;
}

/**
 * One text per student with something new. A student whose count is zero is
 * skipped entirely rather than told "0 new jobs" — a text that says nothing
 * happened is the fastest way to teach someone to ignore the next one.
 */
export function selectWeeklyJobsRecipients(
  candidates: readonly WeeklyCandidate[],
): NudgeSmsPlan[] {
  return candidates
    .filter((candidate) => candidate.newLeadCount > 0)
    .map((candidate) => ({
      studentId: candidate.studentId,
      templateKey: "weekly_jobs",
      body: buildWeeklyJobsSms(candidate.newLeadCount),
      expectsReply: replyToken({ kind: "weekly_jobs" }),
    }));
}
