// =============================================================================
// The employer's side of a Connection — the one bounded `prismaAdmin` helper.
//
// Match & Connect Phase 4, Task 4.4. An employer has no account here, so there
// is no session to derive an RLS context from and no policy branch that could
// admit them. This module is the single, reviewed bypass: it resolves a hashed
// token to exactly ONE Connection and reads only the columns the response page
// renders.
//
// What it deliberately never returns:
//   - the student's id (not in the view model, not in the URL, not in the HTML)
//   - the employer contact's id or address
//   - any fit score, rank, or comparison (design spec §5 and §10)
//
// It also never returns a connection whose class is outside the pilot, whose
// token has expired, or whose status is past the point where a response still
// means something — all four render the same neutral page, so the link cannot
// be used to distinguish "wrong token" from "already answered".
// =============================================================================

import { prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";

import {
  EMPLOYER_VIEW_EVENT_INTERVAL_MS,
  hashEmployerToken,
  normalizeEmployerToken,
} from "./employer-link-shared";
import { isConnectEnabledForClasses, parseConnectScope } from "./flags-shared";
import { parsePacket, type Packet } from "./packet-shared";
import { isEmployerLinkActive, isConnectionStatus, type ConnectionStatus } from "./pipeline-shared";

export * from "./employer-link-shared";

/** The note that marks a view event, so the hourly de-duplication can find it. */
export const VIEW_EVENT_NOTE = "employer_viewed";

/** Everything the public page may know. No ids that identify a person. */
export interface EmployerLinkView {
  connectionId: string;
  status: ConnectionStatus;
  packet: Packet;
  jobTitle: string;
  employerName: string;
  /** The instructor whose slots are offered and who is sender of record. */
  instructorName: string;
  /** Needed to render the slot list; an advisor id is staff, not a student. */
  advisorId: string | null;
  /** Whether a résumé PDF exists to link to. */
  hasPacketPdf: boolean;
}

const CONNECTION_SELECT = {
  id: true,
  status: true,
  packet: true,
  tokenExpiresAt: true,
  sentById: true,
  jobLead: { select: { title: true, classId: true } },
  employer: { select: { name: true } },
  sentBy: { select: { id: true, displayName: true } },
} as const;

/**
 * Resolve a raw URL token to a view model, or null.
 *
 * Null is the only failure this returns; the caller renders one neutral page
 * for it. There is no "expired" branch and no "already answered" branch on
 * purpose: telling a stranger which of those applies confirms that a real
 * connection exists behind the token they tried.
 */
export async function resolveEmployerLink(
  rawToken: string,
  connectScopeRaw: string | null,
  now: Date = new Date(),
): Promise<EmployerLinkView | null> {
  const token = normalizeEmployerToken(rawToken);
  if (!token) return null;

  const scope = parseConnectScope(connectScopeRaw);
  if (scope.mode === "off") return null;

  const connection = await prismaAdmin.connection.findUnique({
    where: { employerTokenHash: hashEmployerToken(token) },
    select: CONNECTION_SELECT,
  });
  if (!connection) return null;
  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() <= now.getTime()) {
    return null;
  }
  if (!isConnectionStatus(connection.status) || !isEmployerLinkActive(connection.status)) {
    return null;
  }

  // A lead with no class is program-wide; the pilot's `classes` mode does not
  // reach it, so a program-wide lead needs `all`.
  const leadClassId = connection.jobLead.classId;
  if (!isConnectEnabledForClasses(scope, leadClassId ? [leadClassId] : [])) return null;

  const packet = parsePacket(connection.packet);
  if (!packet) return null;

  return {
    connectionId: connection.id,
    status: connection.status,
    packet,
    jobTitle: connection.jobLead.title,
    employerName: connection.employer.name,
    instructorName: connection.sentBy?.displayName ?? "Your SPOKES contact",
    advisorId: connection.sentBy?.id ?? null,
    hasPacketPdf: packet.resumeFileUploadId !== null,
  };
}

/**
 * Record that the employer opened the link, at most once an hour.
 *
 * Rate-limited by reading the last `employer_viewed` event rather than by a
 * counter: a mail client that prefetches links, or an employer who refreshes
 * while deciding, would otherwise fill the ledger the student reads on their
 * /memory page with a dozen identical lines.
 *
 * Never throws. A missing view row costs a reporting number; a throw here
 * would take down the page the employer is trying to answer on.
 */
export async function recordEmployerView(
  connectionId: string,
  currentStatus: ConnectionStatus,
  now: Date = new Date(),
): Promise<void> {
  try {
    const recent = await prismaAdmin.connectionEvent.findFirst({
      where: {
        connectionId,
        actorType: "employer",
        note: VIEW_EVENT_NOTE,
        at: { gte: new Date(now.getTime() - EMPLOYER_VIEW_EVENT_INTERVAL_MS) },
      },
      select: { id: true },
    });
    if (recent) return;

    if (currentStatus === "sent") {
      const { transitionConnection } = await import("./pipeline");
      await transitionConnection({
        connectionId,
        to: "viewed",
        actorType: "employer",
        note: VIEW_EVENT_NOTE,
        data: { employerViewedAt: now },
        client: prismaAdmin,
      });
      return;
    }

    await prismaAdmin.connectionEvent.create({
      data: {
        connectionId,
        fromStatus: currentStatus,
        toStatus: currentStatus,
        actorType: "employer",
        note: VIEW_EVENT_NOTE,
        at: now,
      },
    });
  } catch (error) {
    // No connection id in the log line: it resolves to one student's
    // disclosure record for anyone who can also read the database.
    logger.warn("Employer view event not recorded", { error: String(error) });
  }
}

