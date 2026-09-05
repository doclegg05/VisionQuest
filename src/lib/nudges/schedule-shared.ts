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

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

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
  /** OutboundMessage.templateKey values already recorded against this connection. */
  sentTemplateKeys: string[];
  /** Open StudentAlert types already raised for it, so a rule fires once. */
  openAlertTypes: string[];
}

export interface SavedJobSnapshot {
  id: string;
  studentId: string;
  jobTitle: string;
  status: string;
  appliedAt: Date | null;
  alreadyAsked: boolean;
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
  expectsReply: string;
  connectionId?: string;
  savedJobId?: string;
  day?: RetentionDay;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
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
        !connection.openAlertTypes.includes(NUDGE_ALERT_TYPES.employerNoResponse),
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

export function selectInterviewConfirmations(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): NudgeSmsPlan[] {
  const horizon = new Date(now.getTime() + INTERVIEW_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  return connections
    .filter(
      (connection) =>
        connection.status === "interview_scheduled" &&
        connection.interviewStartsAt !== null &&
        connection.interviewStartsAt > now &&
        connection.interviewStartsAt <= horizon &&
        !connection.sentTemplateKeys.includes("interview_confirm"),
    )
    .map((connection) => ({
      studentId: connection.studentId,
      templateKey: "interview_confirm",
      body: buildInterviewConfirmSms({
        employerName: connection.employerName,
        when: formatInterviewWhen(connection.interviewStartsAt as Date),
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

export function selectRetentionChecks(
  connections: readonly ConnectionSnapshot[],
  now: Date,
): NudgeSmsPlan[] {
  const plans: NudgeSmsPlan[] = [];
  for (const connection of connections) {
    const day = NEXT_RETENTION_DAY[connection.status];
    if (!day || !connection.startedAt) continue;
    if (daysBetween(connection.startedAt, now) < day) continue;
    const templateKey = buildRetentionTemplateKey(day);
    if (connection.sentTemplateKeys.includes(templateKey)) continue;

    plans.push({
      studentId: connection.studentId,
      templateKey,
      body: buildRetentionSms(connection.employerName),
      expectsReply: replyToken({ kind: "retention", connectionId: connection.id, day }),
      connectionId: connection.id,
      day,
    });
  }
  return plans;
}

/** Statuses that mean the student has already told us they heard something. */
const HEARD_BACK_PENDING_STATUS = "applied";

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
        !job.alreadyAsked,
    )
    .map((job) => ({
      studentId: job.studentId,
      templateKey: "heard_back",
      body: buildHeardBackSms(job.jobTitle),
      expectsReply: replyToken({ kind: "heard_back", savedJobId: job.id }),
      savedJobId: job.id,
    }));
}

/** Monday, in the 10:00 hour, in America/New_York. */
export function isWeeklyNudgeSlot(now: Date): boolean {
  return isZonedMonday(now) && zonedHour(now) === WEEKLY_NUDGE_HOUR_ET;
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
