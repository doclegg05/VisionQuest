// =============================================================================
// Inbound SMS: STOP/START, and answering the question this program asked.
//
// Match & Connect Phase 5, Task 5.2. Everything the Twilio webhook does after
// it has verified the signature lives here, so the route stays a thin adapter
// and every rule below is unit-testable without an HTTP request.
//
// Four things this module refuses to do, each pinned by a test:
//
//   1. Read a sentence as an opt-out or an answer. Only the exact keywords
//      count (classifyInboundSms), so "stop texting me about the job" reaches
//      a person instead of silently unsubscribing them.
//   2. Manufacture consent. START re-enables a channel someone once agreed to;
//      it cannot create `smsConsentAt` out of nothing.
//   3. Apply an answer to a question nobody asked, or to a stale one. A reply
//      resolves the most recent UNANSWERED question sent to that number in the
//      last 72 hours, and claims it atomically so a double-tap runs once.
//   4. Act on another student's row. The saved job and the connection named in
//      a token are both re-checked against the student the phone belongs to.
//
// --- Clients ---
// The phone lookup, the consent write and the outbound-question claim run on
// prismaAdmin: an inbound webhook has no session, and OutboundMessage is
// staff-only under RLS. They are bounded by shape — the lookup is by phone and
// channel, the writes name one row it returned. Everything that belongs to the
// student (their alert, their saved job, their follow-up) runs inside
// withStudentRlsContext on the app client.
// =============================================================================

import { transitionConnection } from "@/lib/connect/pipeline";
import { prisma, prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { withStudentRlsContext } from "@/lib/rls-context";
import { ensureSpokesRecordForStudent } from "@/lib/spokes";

import { upsertNudgeAlert } from "./alerts";
import { classifyInboundSms } from "./sms-policy-shared";
import {
  NUDGE_ALERT_TYPES,
  parseReplyToken,
  type ReplyToken,
  type RetentionDay,
} from "./schedule-shared";

/**
 * How long a question stays answerable.
 *
 * Three days: long enough for a Friday text answered on Sunday, short enough
 * that a "Y" typed a fortnight later does not silently mark someone employed.
 */
export const REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;

export type InboundOutcome =
  | { outcome: "revoked" }
  | { outcome: "reconsented" }
  | { outcome: "no_prior_consent" }
  | { outcome: "unknown_sender" }
  | { outcome: "no_pending_question" }
  | { outcome: "already_answered" }
  | { outcome: "ignored" }
  | { outcome: "handled"; kind: ReplyToken["kind"] };

// ---------------------------------------------------------------------------
// Phone → student
// ---------------------------------------------------------------------------

/**
 * The forms a US number may have been typed in.
 *
 * The settings field accepts `^\+?[1-9]\d{1,14}$`, so the same phone can be on
 * file as "+13045550123", "13045550123" or "3045550123" while Twilio always
 * reports E.164. Matching a small explicit candidate set keeps the lookup an
 * indexed equality test; a suffix LIKE would scan and could match two people.
 */
export function phoneCandidates(from: string): string[] {
  const digits = from.replace(/\D/g, "");
  if (digits.length === 0) return [];
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const withCountry = national.length === 10 ? `1${national}` : digits;
  return Array.from(new Set([`+${withCountry}`, withCountry, national, from.trim()]));
}

interface SmsRecipient {
  id: string;
  studentId: string;
  smsConsentAt: Date | null;
}

async function findRecipientByPhone(from: string): Promise<SmsRecipient | null> {
  const candidates = phoneCandidates(from);
  if (candidates.length === 0) return null;
  const rows = await prismaAdmin.notificationPreference.findMany({
    where: { channel: "sms", destination: { in: candidates } },
    select: { id: true, studentId: true, smsConsentAt: true },
    take: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    // Two people on one handset is real in this population (a shared family
    // phone). There is no way to tell whose reply this is, so nothing is
    // applied — but the number is still loud enough to be worth an alarm.
    logger.warn("Inbound SMS matched more than one recipient; ignoring", {
      channel: "sms",
      matched: rows.length,
    });
    return null;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export async function handleInboundSms(input: {
  from: string;
  body: string;
  now?: Date;
}): Promise<InboundOutcome> {
  const now = input.now ?? new Date();
  const intent = classifyInboundSms(input.body);

  const recipient = await findRecipientByPhone(input.from);
  if (!recipient) {
    // Never an error: an unknown number that texts STOP has still opted out of
    // everything we could send it, and telling a stranger their number is not
    // on file is an enumeration oracle.
    logger.info("Inbound SMS from an unrecognised number", { channel: "sms", intent });
    return { outcome: "unknown_sender" };
  }

  if (intent === "stop") return revokeConsent(recipient, now);
  if (intent === "start") return restoreConsent(recipient, now);
  if (intent !== "yes" && intent !== "no") {
    logger.info("Inbound SMS was not a keyword; ignoring", { channel: "sms" });
    return { outcome: "ignored" };
  }

  return answerPendingQuestion(recipient, intent === "yes", now);
}

async function revokeConsent(recipient: SmsRecipient, now: Date): Promise<InboundOutcome> {
  await prismaAdmin.notificationPreference.update({
    where: { id: recipient.id },
    // Both, not one: `enabled` is what every sender already reads, and
    // `smsRevokedAt` is the record that survives a later toggle.
    data: { enabled: false, smsRevokedAt: now },
  });
  logger.info("SMS consent revoked by STOP", {
    channel: "sms",
    student: studentLogKey(recipient.studentId),
  });
  return { outcome: "revoked" };
}

async function restoreConsent(recipient: SmsRecipient, now: Date): Promise<InboundOutcome> {
  if (!recipient.smsConsentAt) {
    // START is a resume, not a grant. Someone who never opted in on the
    // settings page cannot opt in by texting a word to a number.
    logger.info("START from a number with no recorded consent; ignoring", { channel: "sms" });
    return { outcome: "no_prior_consent" };
  }
  await prismaAdmin.notificationPreference.update({
    where: { id: recipient.id },
    data: { enabled: true, smsRevokedAt: null },
  });
  logger.info("SMS consent restored by START", {
    channel: "sms",
    student: studentLogKey(recipient.studentId),
    at: now.toISOString(),
  });
  return { outcome: "reconsented" };
}

async function answerPendingQuestion(
  recipient: SmsRecipient,
  affirmative: boolean,
  now: Date,
): Promise<InboundOutcome> {
  const pending = await prismaAdmin.outboundMessage.findFirst({
    where: {
      channel: "sms",
      toKind: "student",
      toId: recipient.studentId,
      expectsReply: { not: null },
      repliedAt: null,
      sentAt: { gte: new Date(now.getTime() - REPLY_WINDOW_MS) },
    },
    orderBy: { sentAt: "desc" },
    select: { id: true, expectsReply: true },
  });
  if (!pending) return { outcome: "no_pending_question" };

  const token = parseReplyToken(pending.expectsReply);
  if (!token) {
    logger.warn("Pending outbound message carried an unreadable reply token", { channel: "sms" });
    return { outcome: "ignored" };
  }

  // Claim first, act second, and claim conditionally on it still being
  // unanswered: two texts arriving together must not both run the handler.
  // A handler that then fails leaves the question burnt, which is the safe
  // direction — the student can ask Sage, and nothing is applied twice.
  const claim = await prismaAdmin.outboundMessage.updateMany({
    where: { id: pending.id, repliedAt: null },
    data: { repliedAt: now },
  });
  if (claim.count === 0) return { outcome: "already_answered" };

  await dispatch(token, recipient.studentId, affirmative, now);
  return { outcome: "handled", kind: token.kind };
}

async function dispatch(
  token: ReplyToken,
  studentId: string,
  affirmative: boolean,
  now: Date,
): Promise<void> {
  switch (token.kind) {
    case "weekly_jobs":
      if (affirmative) await handleWeeklyJobsYes(studentId, now);
      return;
    case "heard_back":
      if (affirmative) await handleHeardBackYes(studentId, token.savedJobId, now);
      return;
    case "retention":
      await handleRetentionAnswer(studentId, token.connectionId, token.day, affirmative, now);
      return;
    case "interview_confirm":
      await handleInterviewAnswer(studentId, token.connectionId, affirmative, now);
      return;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Y to the weekly text: an alert the STUDENT can see, pointing at /career. */
async function handleWeeklyJobsYes(studentId: string, now: Date): Promise<void> {
  await withStudentRlsContext(studentId, () =>
    upsertNudgeAlert(
      {
        studentId,
        // One live "your jobs are ready" card per student, refreshed rather
        // than stacked: a column of identical cards is not more helpful.
        alertKey: `${NUDGE_ALERT_TYPES.weeklyJobsReady}:${studentId}`,
        type: NUDGE_ALERT_TYPES.weeklyJobsReady,
        severity: "low",
        title: "New jobs are ready for you",
        summary: "Sage found new jobs near you. Open Career to see them.",
        sourceType: "job_lead",
        sourceId: studentId,
      },
      now,
    ),
  );
}

/** Y to "did you hear back?": the tracker's own interview state. */
async function handleHeardBackYes(
  studentId: string,
  savedJobId: string,
  _now: Date,
): Promise<void> {
  await withStudentRlsContext(studentId, async () => {
    const savedJob = await prisma.studentSavedJob.findUnique({
      where: { id: savedJobId },
      select: { id: true, studentId: true, status: true },
    });
    // RLS would refuse it anyway; checking here makes the refusal explicit and
    // testable rather than a silent zero-row update.
    if (!savedJob || savedJob.studentId !== studentId) return;
    await prisma.studentSavedJob.update({
      where: { id: savedJob.id },
      data: { status: "interviewing" },
    });
  });
}

const RETENTION_CHECKPOINT_MONTHS: Record<RetentionDay, number> = { 30: 1, 60: 2, 90: 3 };
const RETENTION_TARGET_STATUS: Record<RetentionDay, "retained_30" | "retained_60" | "retained_90"> =
  {
    30: "retained_30",
    60: "retained_60",
    90: "retained_90",
  };

async function handleRetentionAnswer(
  studentId: string,
  connectionId: string,
  day: RetentionDay,
  stillWorking: boolean,
  now: Date,
): Promise<void> {
  const connection = await prismaAdmin.connection.findUnique({
    where: { id: connectionId },
    select: { id: true, studentId: true, status: true, employer: { select: { name: true } } },
  });
  if (!connection || connection.studentId !== studentId) return;
  const employerName = connection.employer?.name ?? "your employer";

  // The SPOKES follow-up row is the student's own record and is written as
  // them; the connection move is a system fact about a disclosure record,
  // whose RLS UPDATE policy admits no student branch for these statuses.
  await withStudentRlsContext(studentId, async () => {
    const record = await ensureSpokesRecordForStudent(studentId);
    const checkpointMonths = RETENTION_CHECKPOINT_MONTHS[day];
    const status = stillWorking ? "employed" : "not_employed";
    const checkedAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    await prisma.spokesEmploymentFollowUp.upsert({
      where: { recordId_checkpointMonths: { recordId: record.id, checkpointMonths } },
      update: { status, checkedAt, notes: `Recorded from the ${day}-day SPOKES text.` },
      create: {
        recordId: record.id,
        checkpointMonths,
        status,
        checkedAt,
        notes: `Recorded from the ${day}-day SPOKES text.`,
      },
    });
  });

  if (stillWorking) {
    await transitionConnection({
      connectionId,
      to: RETENTION_TARGET_STATUS[day],
      actorType: "system",
      note: `Student confirmed by text that they are still working at ${employerName}.`,
      client: prismaAdmin,
    });
    return;
  }

  await transitionConnection({
    connectionId,
    to: "closed",
    actorType: "system",
    note: `Student replied by text that they are no longer working at ${employerName}.`,
    data: { closedReason: "retention_lost" },
    client: prismaAdmin,
  });
  await withStudentRlsContext(studentId, () =>
    upsertNudgeAlert(
      {
        studentId,
        alertKey: `${NUDGE_ALERT_TYPES.retentionLost}:${connectionId}`,
        type: NUDGE_ALERT_TYPES.retentionLost,
        severity: "high",
        title: `Placement at ${employerName} ended`,
        summary:
          `The ${day}-day check-in text came back "no": this student says they are no longer ` +
          `working at ${employerName}. The connection is closed and the SPOKES follow-up is ` +
          `recorded. Reach out before the next reporting period.`,
        sourceType: "connection",
        sourceId: connectionId,
      },
      now,
    ),
  );
}

/**
 * The interview text is a reminder, not a booking. Y changes nothing (the
 * interview is already scheduled and the employer set the time); N raises an
 * instructor alert, because cancelling on an employer is a phone call a person
 * makes, never a status this sweep writes.
 */
async function handleInterviewAnswer(
  studentId: string,
  connectionId: string,
  confirmed: boolean,
  now: Date,
): Promise<void> {
  if (confirmed) return;
  const connection = await prismaAdmin.connection.findUnique({
    where: { id: connectionId },
    select: { id: true, studentId: true, employer: { select: { name: true } } },
  });
  if (!connection || connection.studentId !== studentId) return;
  const employerName = connection.employer?.name ?? "the employer";

  await withStudentRlsContext(studentId, () =>
    upsertNudgeAlert(
      {
        studentId,
        alertKey: `${NUDGE_ALERT_TYPES.interviewUnconfirmed}:${connectionId}`,
        type: NUDGE_ALERT_TYPES.interviewUnconfirmed,
        severity: "high",
        title: `Interview with ${employerName} not confirmed`,
        summary:
          `This student replied "no" to the interview reminder for ${employerName}. ` +
          `Call them, then call the employer — nothing has been cancelled automatically.`,
        sourceType: "connection",
        sourceId: connectionId,
      },
      now,
    ),
  );
}
