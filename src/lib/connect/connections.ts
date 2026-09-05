// =============================================================================
// Connections — propose, approve, send, withdraw, close.
//
// Match & Connect Phase 4, Tasks 4.3 and 4.5. Every write goes through
// `transitionConnection`, so every status change has an event beside it.
//
// The three rules this file exists to enforce, in the order they bite:
//   1. Nothing is sent that a student has not approved. `sendConnection`
//      refuses any status but `student_approved`.
//   2. Nothing is sent without an active `employer_referral` consent, checked
//      again at send time and not merely at approval — a student who revokes
//      in between has revoked.
//   3. An employer is contacted at most three times in any seven days, and the
//      limiter FAILS CLOSED.
// =============================================================================

import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { sendEmail, isEmailDeliveryConfigured } from "@/lib/email";
import { logger } from "@/lib/logger";
import { redactContactInfo } from "@/lib/log-redaction";
import { studentLogKey } from "@/lib/log-keys";
import { rateLimit } from "@/lib/rate-limit";
import { sendNotification } from "@/lib/notifications";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

import { grantConsent, hasActiveConsent } from "@/lib/consent";

import { buildEmployerEmail } from "./employer-email";
import { mintEmployerToken } from "./employer-link-shared";
import { assemblePacket, packetAsJson, renderPacketPdf } from "./packet";
import { parsePacket, type Packet } from "./packet-shared";
import {
  isTerminalConnectionStatus,
  isConnectionStatus,
  transitionConnection,
  type ConnectionStatus,
} from "./pipeline";

/** The design spec §10 default: three packets per employer per week. */
export const EMPLOYER_SEND_LIMIT = 3;
export const EMPLOYER_SEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class ConnectionError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "ConnectionError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------

export interface ProposeInput {
  studentId: string;
  jobLeadId: string;
  proposedById: string;
  /** teacher | sage | student */
  proposedVia: "teacher" | "sage" | "student";
  /** Instructor endorsement, when one is ready at propose time. */
  endorsement?: string;
}

/**
 * Create a proposal.
 *
 * The packet is assembled HERE, not at approval, because the approval card has
 * to show the student the exact contents before they tap. Approval then
 * freezes what is already on the row (and attaches the rendered PDF); nothing
 * after that rewrites it.
 *
 * A proposal is not an approval and sends nothing — that is why a student may
 * create one for themselves (`propose_connection`) under the RLS insert
 * policy's bounded student branch.
 */
export async function proposeConnection(input: ProposeInput) {
  const lead = await prisma.jobLead.findUnique({
    where: { id: input.jobLeadId },
    select: { id: true, employerId: true, status: true, title: true, employer: { select: { name: true, status: true } } },
  });
  if (!lead) throw new ConnectionError("That job wasn't found.", 404);
  if (lead.status !== "open") throw new ConnectionError("That job is not open right now.");
  if (lead.employer.status === "do_not_contact") {
    throw new ConnectionError("We are not contacting that employer.");
  }

  const existing = await prisma.connection.findUnique({
    where: { studentId_jobLeadId: { studentId: input.studentId, jobLeadId: input.jobLeadId } },
    select: { id: true, status: true },
  });
  if (existing) {
    // The unique key makes one connection per (student, lead) forever, which
    // is deliberate: proposing the same student to the same opening twice is
    // an error, not a retry.
    throw new ConnectionError("There is already a connection for this student and job.");
  }

  const connection = await prisma.connection.create({
    data: {
      studentId: input.studentId,
      jobLeadId: input.jobLeadId,
      employerId: lead.employerId,
      proposedById: input.proposedById,
      proposedVia: input.proposedVia,
      status: "proposed",
    },
    select: { id: true },
  });

  // Assembled after the row exists because assemblePacket reads through it.
  const packet = await assemblePacket(connection.id, { endorsement: input.endorsement });
  await prisma.connection.update({
    where: { id: connection.id },
    data: { packet: packetAsJson(packet) },
  });

  await prisma.connectionEvent.create({
    data: {
      connectionId: connection.id,
      fromStatus: null,
      toStatus: "proposed",
      actorType: input.proposedVia === "sage" ? "student" : input.proposedVia,
      actorId: input.proposedById,
      note: `Proposed for "${lead.title}" at ${lead.employer.name}.`,
    },
  });

  await logAuditEvent({
    actorId: input.proposedById,
    actorRole: input.proposedVia === "teacher" ? "teacher" : "student",
    action: "connect.connection.proposed",
    targetType: "connection",
    targetId: connection.id,
    summary: `Proposed an introduction for "${lead.title}" at ${lead.employer.name}.`,
    metadata: { jobLeadId: lead.id, employerId: lead.employerId, via: input.proposedVia },
  });

  return { id: connection.id, packet };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const STUDENT_CONNECTION_SELECT = {
  id: true,
  status: true,
  statusChangedAt: true,
  packet: true,
  sentAt: true,
  proposedVia: true,
  jobLead: { select: { id: true, title: true, location: true } },
  employer: { select: { name: true } },
} as const;

export interface StudentConnectionView {
  id: string;
  status: ConnectionStatus;
  jobTitle: string;
  location: string;
  employerName: string;
  packet: Packet | null;
  statusChangedAt: string;
  sentAt: string | null;
}

function toStudentView(row: {
  id: string;
  status: string;
  statusChangedAt: Date;
  packet: unknown;
  sentAt: Date | null;
  jobLead: { title: string; location: string };
  employer: { name: string };
}): StudentConnectionView | null {
  if (!isConnectionStatus(row.status)) return null;
  return {
    id: row.id,
    status: row.status,
    jobTitle: row.jobLead.title,
    location: row.jobLead.location,
    employerName: row.employer.name,
    packet: parsePacket(row.packet),
    statusChangedAt: row.statusChangedAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  };
}

/** Proposals waiting on this student's tap. Their own rows only, by RLS. */
export async function listPendingForStudent(studentId: string) {
  const rows = await prisma.connection.findMany({
    where: { studentId, status: "proposed" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: STUDENT_CONNECTION_SELECT,
  });
  return rows.map(toStudentView).filter((row): row is StudentConnectionView => row !== null);
}

/** Everything ever shared about this student, for the /memory disclosure list. */
export async function listSharedWithEmployers(studentId: string) {
  const rows = await prisma.connection.findMany({
    where: { studentId, sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    take: 100,
    select: STUDENT_CONNECTION_SELECT,
  });
  return rows.map(toStudentView).filter((row): row is StudentConnectionView => row !== null);
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

/**
 * The student's tap.
 *
 * Writes the `employer_referral` consent if it is not already active — this
 * IS the informed consent moment, and the packet's field list was on the card
 * they tapped. Then renders the PDF and freezes the packet.
 */
export async function approveConnection(connectionId: string, studentId: string) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, studentId },
    select: { id: true, status: true, packet: true },
  });
  if (!connection) throw new ConnectionError("That connection wasn't found.", 404);
  if (connection.status !== "proposed") {
    throw new ConnectionError("That connection is not waiting for your OK.");
  }

  const packet = parsePacket(connection.packet);
  if (!packet) throw new ConnectionError("That connection has nothing to send yet.");

  await grantConsent(studentId, "employer_referral", studentId);
  const consent = await prisma.consentRecord.findFirst({
    where: { studentId, scope: "employer_referral", revokedAt: null },
    select: { id: true },
  });

  const resumeFileUploadId = await renderPacketPdf(studentId, packet);
  const frozen: Packet = { ...packet, resumeFileUploadId };

  await transitionConnection({
    connectionId,
    to: "student_approved",
    expectedFrom: "proposed",
    actorType: "student",
    actorId: studentId,
    note: "The student approved what would be shared.",
    data: {
      packet: packetAsJson(frozen),
      ...(consent ? { consentRecord: { connect: { id: consent.id } } } : {}),
    },
  });

  await logAuditEvent({
    actorId: studentId,
    actorRole: "student",
    action: "connect.connection.approved",
    targetType: "connection",
    targetId: connectionId,
    summary: "The student approved an introduction to an employer.",
    metadata: { fields: frozen.includedFields },
  });

  return frozen;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendResult {
  connectionId: string;
  /** For the console's confirmation line. Never the token. */
  contactName: string;
  expiresAt: string;
}

/**
 * The per-employer send limit.
 *
 * Two checks, and both must pass:
 *
 *   1. A TRUE rolling seven-day count of OutboundMessage rows for this
 *      employer. `rateLimit()`'s window is fixed and anchored on its first
 *      call, which would let three sends at the end of one window and three at
 *      the start of the next put six packets in front of an employer inside a
 *      few days.
 *   2. `rateLimit()` itself, whose single atomic upsert is what stops two
 *      instructors clicking Send at the same moment from both reading "two so
 *      far". The count in (1) cannot do that on its own — it is a read.
 *
 * FAIL CLOSED: `rateLimit()` is designed to fail OPEN when its store is
 * unavailable (right for a shared classroom login, wrong here), so a degraded
 * result is treated as a refusal. Over-contacting a local employer costs the
 * program a relationship it cannot rebuild; a delayed packet costs a day.
 */
async function assertEmployerSendAllowed(employerId: string, now: Date): Promise<void> {
  const recentSends = await prisma.outboundMessage.count({
    where: {
      channel: "email",
      toKind: "employer_contact",
      sentAt: { gte: new Date(now.getTime() - EMPLOYER_SEND_WINDOW_MS) },
      connection: { employerId },
    },
  });
  if (recentSends >= EMPLOYER_SEND_LIMIT) {
    throw new ConnectionError(
      `This employer has already had ${EMPLOYER_SEND_LIMIT} packets in the last 7 days. Try again next week.`,
      429,
    );
  }

  const limit = await rateLimit(
    `connect-send:${employerId}`,
    EMPLOYER_SEND_LIMIT,
    EMPLOYER_SEND_WINDOW_MS,
  );
  if (!limit.success || limit.degraded) {
    throw new ConnectionError(
      "We can't send to this employer right now. Try again shortly.",
      429,
    );
  }
}

export interface SendOptions {
  senderId: string;
  senderRole: string;
  senderName: string;
  programName: string;
  programEmail: string;
  /** Absolute origin, e.g. https://visionquest.onrender.com */
  baseUrl: string;
  now?: Date;
}

export async function sendConnection(
  connectionId: string,
  options: SendOptions,
): Promise<SendResult> {
  const now = options.now ?? new Date();

  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      packet: true,
      employerId: true,
      employer: { select: { name: true, status: true } },
      jobLead: {
        select: {
          title: true,
          contactId: true,
          contact: { select: { id: true, name: true, email: true, doNotContactAt: true } },
        },
      },
    },
  });
  if (!connection) throw new ConnectionError("That connection wasn't found.", 404);

  // 1. Student approval. The single most important check in this file.
  if (connection.status !== "student_approved") {
    throw new ConnectionError("The student has not approved this yet.");
  }

  // 2. Consent, re-checked at send. Approval wrote it; a student may have
  //    revoked in the meantime, and a revocation means nothing goes.
  if (!(await hasActiveConsent(connection.studentId, "employer_referral"))) {
    throw new ConnectionError("The student has taken back permission to share.");
  }

  if (connection.employer.status === "do_not_contact") {
    throw new ConnectionError("We are not contacting that employer.");
  }

  const contact = connection.jobLead.contact;
  if (!contact || !contact.email) {
    throw new ConnectionError("That job has no contact with an email address.");
  }
  if (contact.doNotContactAt) {
    throw new ConnectionError("That contact asked not to be emailed.");
  }

  const packet = parsePacket(connection.packet);
  if (!packet) throw new ConnectionError("That connection has nothing to send yet.");

  await assertEmployerSendAllowed(connection.employerId, now);

  const { token, tokenHash, expiresAt } = mintEmployerToken(now);
  const email = buildEmployerEmail({
    packet,
    contactName: sanitizeForPrompt(contact.name),
    jobTitle: sanitizeForPrompt(connection.jobLead.title),
    employerName: sanitizeForPrompt(connection.employer.name),
    instructorName: options.senderName,
    programEmail: options.programEmail,
    programName: options.programName,
    responseUrl: `${options.baseUrl.replace(/\/$/, "")}/connect/${token}`,
  });

  if (!isEmailDeliveryConfigured()) {
    throw new ConnectionError("Email is not set up, so nothing was sent.", 503);
  }

  try {
    await sendEmail({ to: contact.email, subject: email.subject, text: email.text });
  } catch (error) {
    // The address is quoted back inside SMTP error text, so it is redacted
    // before the line is written — the same trap notifications.ts hit.
    logger.error("Employer packet email failed", {
      actorId: options.senderId,
      student: studentLogKey(connection.studentId),
      error: redactContactInfo(String(error)),
    });
    throw new ConnectionError("That email didn't go through. Nothing was sent.", 502);
  }

  await transitionConnection({
    connectionId,
    to: "sent",
    expectedFrom: "student_approved",
    actorType: options.senderRole === "admin" ? "admin" : "teacher",
    actorId: options.senderId,
    note: `Sent to ${contact.name}.`,
    data: {
      sentAt: now,
      sentBy: { connect: { id: options.senderId } },
      employerTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
      tokenContactId: contact.id,
    },
  });

  await prisma.outboundMessage.create({
    data: {
      channel: "email",
      toKind: "employer_contact",
      toId: contact.id,
      templateKey: "connect.employer_packet",
      body: email.text,
      connectionId,
      status: "sent",
    },
  });

  await logAuditEvent({
    actorId: options.senderId,
    actorRole: options.senderRole,
    action: "connect.connection.sent",
    targetType: "connection",
    targetId: connectionId,
    summary: `Sent a candidate packet to ${connection.employer.name}.`,
    // No token, no token hash, no student id: the audit row is looked up by
    // its targetId, which is the connection.
    metadata: { employerId: connection.employerId, fields: packet.includedFields },
  });

  return {
    connectionId,
    contactName: contact.name,
    expiresAt: expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Withdraw / close
// ---------------------------------------------------------------------------

/** The student takes it back, from any non-terminal state. */
export async function withdrawConnection(connectionId: string, studentId: string) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, studentId },
    select: { id: true, status: true, sentById: true },
  });
  if (!connection) throw new ConnectionError("That connection wasn't found.", 404);
  if (!isConnectionStatus(connection.status)) {
    throw new ConnectionError("That connection is in an unknown state.");
  }
  if (isTerminalConnectionStatus(connection.status)) {
    throw new ConnectionError("That connection is already closed.");
  }

  await transitionConnection({
    connectionId,
    to: "withdrawn",
    expectedFrom: connection.status,
    actorType: "student",
    actorId: studentId,
    note: "The student took this back.",
    // The token stops working the moment the status leaves the active set,
    // and it is cleared here so nothing can be resolved by it at all.
    data: { employerTokenHash: null, tokenExpiresAt: null },
  });

  if (connection.sentById) {
    await notifyQuietly(connection.sentById, {
      type: "connect_withdrawn",
      title: "A student took back an introduction",
      body: "Open Connect to see which one.",
    });
  }

  await logAuditEvent({
    actorId: studentId,
    actorRole: "student",
    action: "connect.connection.withdrawn",
    targetType: "connection",
    targetId: connectionId,
    summary: "The student withdrew an employer introduction.",
  });
}

/** The instructor closes it, with a reason. */
export async function closeConnection(
  connectionId: string,
  actor: { id: string; role: string },
  reason: string,
) {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { id: true, status: true, studentId: true },
  });
  if (!connection) throw new ConnectionError("That connection wasn't found.", 404);
  if (!isConnectionStatus(connection.status)) {
    throw new ConnectionError("That connection is in an unknown state.");
  }
  if (isTerminalConnectionStatus(connection.status)) {
    throw new ConnectionError("That connection is already closed.");
  }

  await transitionConnection({
    connectionId,
    to: "closed",
    expectedFrom: connection.status,
    actorType: actor.role === "admin" ? "admin" : "teacher",
    actorId: actor.id,
    note: reason,
    data: { closedReason: reason, employerTokenHash: null, tokenExpiresAt: null },
  });

  await notifyQuietly(connection.studentId, {
    type: "connect_closed",
    title: "Your teacher closed one of your job introductions",
    body: reason,
  });

  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "connect.connection.closed",
    targetType: "connection",
    targetId: connectionId,
    summary: "An instructor closed an employer introduction.",
    metadata: { reason },
  });
}

/**
 * Consent revocation withdraws every non-terminal connection.
 *
 * Called from `revokeConsent` for the `employer_referral` scope. Each one
 * writes its own event, so the student's /memory page shows what the
 * revocation actually did rather than a silent state change.
 */
export async function withdrawConnectionsForConsentRevocation(
  studentId: string,
  actorId: string,
): Promise<{ withdrawn: number }> {
  const open = await prisma.connection.findMany({
    where: {
      studentId,
      status: { notIn: ["not_now", "retained_90", "withdrawn", "closed"] },
    },
    select: { id: true, status: true },
  });

  let withdrawn = 0;
  for (const row of open) {
    if (!isConnectionStatus(row.status)) continue;
    try {
      await transitionConnection({
        connectionId: row.id,
        to: "withdrawn",
        expectedFrom: row.status,
        // The student is the actor even when staff recorded the revocation:
        // it is their permission that was taken back.
        actorType: "student",
        actorId: studentId,
        note: "Permission to share with employers was taken back.",
        data: { employerTokenHash: null, tokenExpiresAt: null },
      });
      withdrawn += 1;
    } catch (error) {
      logger.warn("Connection not withdrawn on consent revocation", {
        actorId,
        student: studentLogKey(studentId),
        error: String(error),
      });
    }
  }

  return { withdrawn };
}

/** In-app notification that must never fail the action that triggered it. */
async function notifyQuietly(
  userId: string,
  payload: { type: string; title: string; body?: string },
) {
  try {
    await sendNotification(userId, payload);
  } catch {
    // Deliberately silent: the transition is what matters and it has already
    // committed. A notification failure is not worth a 500 to the caller.
  }
}
