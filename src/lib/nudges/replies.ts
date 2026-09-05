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

import type { Prisma } from "@prisma/client";

import {
  ConnectionConflictError,
  ConnectionNotFoundError,
  TransitionNotAllowedError,
  transitionConnection,
  type ConnectionStatus,
} from "@/lib/connect/pipeline";
import { prisma, prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { withStudentRlsContext } from "@/lib/rls-context";

import { upsertNudgeAlert } from "./alerts";
import { sendPolicySms } from "./sms-policy";
import { buildInterviewDeclineAckSms, classifyInboundSms } from "./sms-policy-shared";
import {
  NUDGE_ALERT_TYPES,
  interviewDeclineAckTemplateKey,
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
  /** More than one student has this number on file. See findRecipients(). */
  | { outcome: "ambiguous_sender" }
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

/**
 * Every preference row this number matches.
 *
 * Two people on one handset is real in this population — a shared family
 * phone, a student using a partner's number. The rows are returned rather than
 * collapsed to null because STOP and everything else need OPPOSITE answers to
 * that ambiguity: a STOP must apply to all of them, while a "Y" must apply to
 * none. Under-revoking keeps texting someone who asked you to stop, which is
 * the thing TCPA is actually about; over-revoking costs a text nobody gets and
 * a START to undo.
 */
async function findRecipients(from: string): Promise<SmsRecipient[]> {
  const candidates = phoneCandidates(from);
  if (candidates.length === 0) return [];
  return prismaAdmin.notificationPreference.findMany({
    where: { channel: "sms", destination: { in: candidates } },
    select: { id: true, studentId: true, smsConsentAt: true },
    take: 10,
  });
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

  const recipients = await findRecipients(input.from);
  if (recipients.length === 0) {
    // Never an error: an unknown number that texts STOP has still opted out of
    // everything we could send it, and telling a stranger their number is not
    // on file is an enumeration oracle.
    logger.info("Inbound SMS from an unrecognised number", { channel: "sms" });
    return { outcome: "unknown_sender" };
  }

  // A STOP is answered before anything else is even classified in context: it
  // must never be read as an answer to a pending question, and it applies to
  // every row this handset matches.
  const stopFirst = classifyInboundSms(input.body);
  if (stopFirst === "stop") return revokeConsent(recipients, now);

  if (recipients.length > 1) {
    // Everything that is not STOP needs to know WHOSE reply this is, and here
    // nothing can. Loud, because a shared number silently swallowing answers
    // looks exactly like a student who never replies.
    logger.warn("Inbound SMS matched more than one recipient; applying nothing", {
      channel: "sms",
      matched: recipients.length,
    });
    return { outcome: "ambiguous_sender" };
  }

  const recipient = recipients[0];
  const pending = await findPendingQuestion(recipient.studentId, now);
  // "YES" is an opt-in keyword to Twilio and an answer to a person. Only the
  // presence of an open question can tell the two apart.
  const intent = classifyInboundSms(input.body, { hasPendingQuestion: pending !== null });

  if (intent === "start") return restoreConsent(recipient, now);
  if (intent !== "yes" && intent !== "no") {
    logger.info("Inbound SMS was not a keyword; ignoring", { channel: "sms" });
    return { outcome: "ignored" };
  }
  if (!pending) return { outcome: "no_pending_question" };

  return answerPendingQuestion(recipient, pending, intent === "yes", now);
}

async function revokeConsent(
  recipients: SmsRecipient[],
  now: Date,
): Promise<InboundOutcome> {
  await prismaAdmin.notificationPreference.updateMany({
    where: { id: { in: recipients.map((row) => row.id) } },
    // Both, not one: `enabled` is what every sender already reads, and
    // `smsRevokedAt` is the record that survives a later toggle.
    data: { enabled: false, smsRevokedAt: now },
  });
  logger.info("SMS consent revoked by STOP", {
    channel: "sms",
    recipients: recipients.length,
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

interface PendingQuestion {
  id: string;
  expectsReply: string | null;
}

/**
 * The most recent unanswered question sent to this student inside the window.
 *
 * Exported through `hasUnansweredQuestion` for the runner, which uses the same
 * definition to avoid stacking a second question on top of an open one — two
 * questions in flight make a bare "Y" ambiguous no matter how carefully the
 * token is written.
 */
async function findPendingQuestion(
  studentId: string,
  now: Date,
): Promise<PendingQuestion | null> {
  return prismaAdmin.outboundMessage.findFirst({
    where: {
      channel: "sms",
      toKind: "student",
      toId: studentId,
      status: "sent",
      expectsReply: { not: null },
      repliedAt: null,
      sentAt: { gte: new Date(now.getTime() - REPLY_WINDOW_MS) },
    },
    orderBy: { sentAt: "desc" },
    select: { id: true, expectsReply: true },
  });
}

/** Student ids with an open question right now — the runner's #4 guard. */
export async function studentsWithOpenQuestions(
  studentIds: string[],
  now: Date,
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await prismaAdmin.outboundMessage.findMany({
    where: {
      channel: "sms",
      toKind: "student",
      toId: { in: studentIds },
      status: "sent",
      expectsReply: { not: null },
      repliedAt: null,
      sentAt: { gte: new Date(now.getTime() - REPLY_WINDOW_MS) },
    },
    select: { toId: true },
  });
  return new Set(rows.map((row) => row.toId));
}

async function answerPendingQuestion(
  recipient: SmsRecipient,
  pending: PendingQuestion,
  affirmative: boolean,
  now: Date,
): Promise<InboundOutcome> {
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

/**
 * Move a connection, and treat a refusal as a fact about the world rather than
 * an error to propagate.
 *
 * The pipeline legitimately refuses when the row moved between the text going
 * out and the answer coming back — an instructor closed it, the student
 * withdrew, a second reply raced this one. None of those mean the student's
 * answer should be discarded, and none of them should take down the webhook.
 * Returns whether the move landed, so a caller can say so in its alert.
 */
async function tryTransition(input: {
  connectionId: string;
  to: ConnectionStatus;
  note: string;
  data?: Prisma.ConnectionUpdateInput;
}): Promise<boolean> {
  try {
    await transitionConnection({
      connectionId: input.connectionId,
      to: input.to,
      actorType: "system",
      note: input.note,
      data: input.data,
      client: prismaAdmin,
    });
    return true;
  } catch (error) {
    if (
      error instanceof TransitionNotAllowedError ||
      error instanceof ConnectionConflictError ||
      error instanceof ConnectionNotFoundError
    ) {
      logger.warn("Retention reply could not move the connection; alerting staff anyway", {
        channel: "sms",
        to: input.to,
        reason: error.name,
      });
      return false;
    }
    throw error;
  }
}

const RETENTION_TARGET_STATUS: Record<RetentionDay, "retained_30" | "retained_60" | "retained_90"> =
  {
    30: "retained_30",
    60: "retained_60",
    90: "retained_90",
  };

/**
 * The retention answer moves the CONNECT funnel and asks a person to reconcile
 * the grant record. It deliberately writes no `SpokesEmploymentFollowUp` row.
 *
 * Two clocks that look alike are not the same clock: the funnel counts 30/60/90
 * days from `Connection.startedAt`, while `SpokesEmploymentFollowUp` runs on
 * 1/3/6 MONTHS from `SpokesRecord.unsubsidizedEmploymentAt` and is what
 * grant-kpi.ts reports to DoHS. Mapping one onto the other would have had a
 * one-character text overwrite a teacher's verified row on the shared
 * `(recordId, checkpointMonths)` unique key, with no provenance to tell them
 * apart — and it would have parked the day-60 answer at `checkpointMonths: 2`,
 * which no reader in this codebase looks at.
 *
 * Phase 6 reads Connect retention from the ConnectionEvent history, so the
 * funnel loses nothing. The staff alert is the reconciliation point.
 */
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

  if (stillWorking) {
    // The connection move is a system fact about a disclosure record, whose
    // RLS UPDATE policy admits no student branch for these statuses.
    //
    // The transition is allowed to FAIL without losing the answer: an
    // instructor may have closed or withdrawn the connection between the text
    // going out and the reply coming back, and a TransitionNotAllowedError
    // would otherwise throw away the one thing the student told us. The alert
    // is the durable record, so it is raised either way.
    await tryTransition({
      connectionId,
      to: RETENTION_TARGET_STATUS[day],
      note: `Student confirmed by text that they are still working at ${employerName}.`,
    });
    await withStudentRlsContext(studentId, () =>
      upsertNudgeAlert(
        {
          studentId,
          // Keyed by (connection, day): one card per checkpoint, so a teacher
          // who records the 1-month follow-up is not asked again at day 60.
          alertKey: `${NUDGE_ALERT_TYPES.retentionConfirm}:${connectionId}:${day}`,
          type: NUDGE_ALERT_TYPES.retentionConfirm,
          severity: "medium",
          title: `${employerName}: still working at day ${day}`,
          summary:
            `The student replied "yes" to the day-${day} check-in text, so the Connect ` +
            `funnel is updated. That is self-reported, not evidence. Record the SPOKES ` +
            `employment follow-up yourself once you can confirm it — those checkpoints ` +
            `run 1, 3 and 6 months from the employment date on the SPOKES record, which ` +
            `is a different clock from this one.`,
          sourceType: "connection",
          sourceId: connectionId,
        },
        now,
      ),
    );
    return;
  }

  await tryTransition({
    connectionId,
    to: "closed",
    note: `Student replied by text that they are no longer working at ${employerName}.`,
    data: { closedReason: "retention_lost" },
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
          `The day-${day} check-in text came back "no": this student says they are no longer ` +
          `working at ${employerName}. The connection is closed. Nothing has been written to ` +
          `the SPOKES employment follow-ups — record that yourself once you know what ` +
          `happened, before the next reporting period.`,
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

  // Tell them something happened. Saying "no" to an interview reminder and
  // hearing nothing back is the moment a student decides the texts are a
  // machine that does not listen.
  //
  // Through the policy, never inline: quiet hours and the daily cap apply to
  // an acknowledgement exactly as they do to a nudge, so a "no" typed at 11pm
  // is answered at 8am rather than waking the house. `sendPolicySms` returns
  // `deferred` in that case and the NEXT runner sweep re-derives this ack from
  // the still-open alert, so nothing is queued anywhere.
  await sendPolicySms({
    studentId,
    templateKey: interviewDeclineAckTemplateKey(connectionId),
    body: buildInterviewDeclineAckSms(),
    connectionId,
    now,
  });

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
