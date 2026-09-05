// =============================================================================
// What the employer can do with the link — Match & Connect Tasks 4.4 and 4.5.
//
// Three answers: Interested (pick a time), Not now (optional reason), Hired
// (start date and wage). All three run through `prismaAdmin` for the same
// reason `employer-link.ts` does: the actor has no account here, so there is
// no RLS context to derive. Each one resolves the token first and touches only
// the connection behind it.
//
// The hire path is the one that has to be exactly right, because it is where
// this feature meets the program's existing placement reporting:
//   - an Application with verificationStatus "verified" (the instructor who
//     sent the packet is the verifier — they set up the introduction and the
//     employer confirmed it on a link only they were sent);
//   - an Opportunity mirror of the lead, because Application hangs off
//     Opportunity and the placement bridge reads through it. INTERIM: owner
//     decision D5 (spec §12.5) proposes retiring Opportunity in favour of
//     JobLead; until that lands, the mirror keeps the bridge's contract
//     intact rather than forking it;
//   - `Connection.applicationId`, which is unique, so a retried hire finds the
//     existing Application instead of creating a second one.
// =============================================================================

import { logAuditEvent } from "@/lib/audit";
import { prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";
import { OUTCOME_VERIFICATION } from "@/lib/outcome-verification";
import { withStudentRlsContext } from "@/lib/rls-context";
import { buildBookableAdvisorSlots, type BookableSlot } from "@/lib/advising-scheduling";
import type { AvailabilityLocationType } from "@/lib/advising";

import {
  NOT_NOW_REASON_LABELS,
  type NotNowReason,
} from "./employer-actions-shared";
import { transitionConnection } from "./pipeline";
import type { ConnectionStatus } from "./pipeline-shared";

export * from "./employer-actions-shared";

export class EmployerActionError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "EmployerActionError";
    this.status = status;
  }
}

/** Marks a mirrored Opportunity so the interim is findable and reversible. */
export const OPPORTUNITY_MIRROR_MARKER = "[connect:job-lead]";

// ---------------------------------------------------------------------------
// Interested → book an interview
// ---------------------------------------------------------------------------

/** How far ahead the employer may book. Ten business days ≈ two weeks. */
export const EMPLOYER_SLOT_DAYS = 14;
export const EMPLOYER_MAX_SLOTS = 10;

/**
 * The sending instructor's open slots.
 *
 * `listBookableAdvisors` runs on the RLS-bound client and covers every
 * advisor, so it cannot serve this page. The slot maths is the pure
 * `buildBookableAdvisorSlots`, reused unchanged, over an admin read scoped to
 * ONE advisor — the person who sent the packet, and nobody else.
 */
export async function listInstructorSlots(
  advisorId: string,
  now: Date = new Date(),
): Promise<BookableSlot[]> {
  const [blocks, appointments] = await Promise.all([
    prismaAdmin.advisorAvailability.findMany({
      where: { advisorId, active: true },
      select: {
        id: true,
        advisorId: true,
        weekday: true,
        startMinutes: true,
        endMinutes: true,
        slotMinutes: true,
        locationType: true,
        locationLabel: true,
        meetingUrl: true,
        active: true,
        advisor: { select: { displayName: true, email: true } },
      },
      orderBy: [{ weekday: "asc" }, { startMinutes: "asc" }],
    }),
    prismaAdmin.appointment.findMany({
      where: { advisorId, status: "scheduled", startsAt: { gte: now } },
      select: { advisorId: true, startsAt: true, endsAt: true, status: true },
    }),
  ]);

  const [advisor] = buildBookableAdvisorSlots({
    advisors: blocks.map((block) => ({
      ...block,
      locationType: block.locationType as AvailabilityLocationType,
      advisorName: block.advisor.displayName,
      advisorEmail: block.advisor.email,
    })),
    appointments,
    now,
    days: EMPLOYER_SLOT_DAYS,
    maxSlotsPerAdvisor: EMPLOYER_MAX_SLOTS,
    minimumLeadMinutes: 60,
  });

  return advisor?.slots ?? [];
}

export interface InterestedInput {
  connectionId: string;
  currentStatus: ConnectionStatus;
  startsAt: string;
  contactName: string;
  contactEmail: string;
}

/**
 * Book the interview and move to `interview_scheduled`.
 *
 * The slot race is decided by the database, exactly as it is for a student
 * self-booking: migration 20260902140000's partial unique index on
 * (advisorId, startsAt) WHERE status = 'scheduled' means the loser of two
 * simultaneous bookings gets P2002, which becomes a 409 here rather than a
 * second appointment in the same half hour.
 */
export async function recordInterested(input: InterestedInput) {
  const connection = await prismaAdmin.connection.findUnique({
    where: { id: input.connectionId },
    select: {
      id: true,
      studentId: true,
      sentById: true,
      employerId: true,
      jobLead: { select: { title: true } },
      employer: { select: { name: true } },
    },
  });
  if (!connection || !connection.sentById) {
    throw new EmployerActionError("That link is no longer active.", 404);
  }

  const slots = await listInstructorSlots(connection.sentById);
  const slot = slots.find((entry) => entry.startsAt === input.startsAt);
  if (!slot) throw new EmployerActionError("That time is no longer open.", 409);

  let appointmentId: string;
  try {
    const appointment = await prismaAdmin.appointment.create({
      data: {
        studentId: connection.studentId,
        advisorId: connection.sentById,
        title: `Interview: ${connection.jobLead.title}`,
        description: `Interview with ${connection.employer.name}.`,
        startsAt: new Date(slot.startsAt),
        endsAt: new Date(slot.endsAt),
        locationType: slot.locationType,
        locationLabel: slot.locationLabel,
        meetingUrl: slot.meetingUrl,
        bookingSource: "employer",
        status: "scheduled",
        externalAttendee: {
          name: input.contactName,
          email: input.contactEmail,
          employerId: connection.employerId,
        },
      },
      select: { id: true },
    });
    appointmentId = appointment.id;
  } catch (error) {
    if (isScheduledSlotViolation(error)) {
      throw new EmployerActionError("That time was just taken. Pick another time.", 409);
    }
    throw error;
  }

  await transitionConnection({
    connectionId: input.connectionId,
    to: "interview_scheduled",
    expectedFrom: input.currentStatus,
    actorType: "employer",
    note: "The employer asked to meet and picked a time.",
    data: {
      employerRespondedAt: new Date(),
      employerResponse: "interested",
      interviewAppointmentId: appointmentId,
    },
    client: prismaAdmin,
  });

  await notifyStudent(connection.studentId, {
    type: "connect_interview",
    title: "An employer wants to meet you",
    body: `${connection.employer.name} picked a time. Check your appointments.`,
  });
  if (connection.sentById) {
    await notifyStaff(connection.sentById, {
      type: "connect_interview",
      title: "An employer booked an interview",
      body: `${connection.employer.name} booked a time for a student.`,
    });
  }

  await logAuditEvent({
    actorId: null,
    actorRole: "employer",
    action: "connect.employer.interested",
    targetType: "connection",
    targetId: input.connectionId,
    summary: "An employer asked to meet a candidate and booked a time.",
    metadata: { appointmentId },
  });

  return { appointmentId, startsAt: slot.startsAt };
}

// ---------------------------------------------------------------------------
// Not now
// ---------------------------------------------------------------------------

export async function recordNotNow(input: {
  connectionId: string;
  currentStatus: ConnectionStatus;
  reason: NotNowReason;
  note?: string | null;
}) {
  const connection = await prismaAdmin.connection.findUnique({
    where: { id: input.connectionId },
    select: { studentId: true, sentById: true, employer: { select: { name: true } } },
  });
  if (!connection) throw new EmployerActionError("That link is no longer active.", 404);

  const label = NOT_NOW_REASON_LABELS[input.reason];
  const note = input.note ? `${label}: ${input.note}` : label;

  await transitionConnection({
    connectionId: input.connectionId,
    to: "not_now",
    expectedFrom: input.currentStatus,
    actorType: "employer",
    note,
    data: {
      employerRespondedAt: new Date(),
      employerResponse: "not_now",
      responseReason: note.slice(0, 500),
      // Terminal: the link stops resolving, and the token is cleared so it
      // cannot be resolved at all.
      employerTokenHash: null,
      tokenExpiresAt: null,
    },
    client: prismaAdmin,
  });

  if (connection.sentById) {
    await notifyStaff(connection.sentById, {
      type: "connect_not_now",
      title: "An employer said not right now",
      body: `${connection.employer.name}: ${label}`,
    });
  }

  await logAuditEvent({
    actorId: null,
    actorRole: "employer",
    action: "connect.employer.not_now",
    targetType: "connection",
    targetId: input.connectionId,
    summary: "An employer declined for now.",
    metadata: { reason: input.reason },
  });
}

// ---------------------------------------------------------------------------
// Hired → the outcome capture
// ---------------------------------------------------------------------------

export interface HiredInput {
  connectionId: string;
  currentStatus: ConnectionStatus;
  /** YYYY-MM-DD */
  startDate: string;
  hourlyWage: number;
}

/**
 * Record a hire and hand it to the program's existing placement machinery.
 *
 * Idempotent on retry: `Connection.applicationId` is unique and the
 * Application itself is unique on (studentId, opportunityId), so a second call
 * finds both rather than creating either again — and `syncStudentAlerts`
 * upserts the `placement_outcome_pending` queue item by `alertKey`, so exactly
 * one alert exists no matter how many times this runs.
 */
export async function recordHired(input: HiredInput) {
  const connection = await prismaAdmin.connection.findUnique({
    where: { id: input.connectionId },
    select: {
      id: true,
      studentId: true,
      sentById: true,
      applicationId: true,
      jobLead: {
        select: { id: true, title: true, location: true, employer: { select: { name: true } } },
      },
      employer: { select: { name: true } },
    },
  });
  if (!connection) throw new EmployerActionError("That link is no longer active.", 404);

  const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime())) {
    throw new EmployerActionError("That start date isn't a real date.", 400);
  }

  const applicationId =
    connection.applicationId ??
    (await createVerifiedApplication({
      studentId: connection.studentId,
      verifiedBy: connection.sentById,
      lead: connection.jobLead,
    }));

  await transitionConnection({
    connectionId: input.connectionId,
    to: "hired",
    expectedFrom: input.currentStatus,
    actorType: "employer",
    note: `Hired, starting ${input.startDate}.`,
    data: {
      employerRespondedAt: new Date(),
      employerResponse: "hired",
      hiredAt: new Date(),
      startDate,
      hourlyWage: input.hourlyWage,
      applicationId,
      // The link has done its job. Clearing the token is what makes a replay
      // after a hire resolve to the neutral page rather than the packet.
      employerTokenHash: null,
      tokenExpiresAt: null,
    },
    client: prismaAdmin,
  });

  // The bridge reads a verified accepted Application and raises its own queue
  // item; `placement_bridge_classes` now follows `connect_enabled_classes`
  // (mergePlacementBridgeScopes), so a Connect pilot class gets it without a
  // second flag being set.
  try {
    const { syncStudentAlerts } = await import("@/lib/advising");
    // The sync reads and writes the student's own rows on the app client, so
    // it needs their context — without it every query fails closed and the
    // placement queue item is silently never raised (the F62 class of bug).
    await withStudentRlsContext(connection.studentId, () =>
      syncStudentAlerts(connection.studentId),
    );
  } catch (error) {
    logger.warn("Placement alert sync after hire failed", { error: String(error) });
  }

  await notifyStudent(connection.studentId, {
    type: "connect_hired",
    title: "You got the job",
    body: `${connection.employer.name} says you are hired. Tell your teacher if anything is wrong.`,
  });
  if (connection.sentById) {
    await notifyStaff(connection.sentById, {
      type: "connect_hired",
      title: "An employer recorded a hire",
      body: `${connection.employer.name} hired a student. Record the placement on their SPOKES record.`,
    });
  }

  await logAuditEvent({
    actorId: null,
    actorRole: "employer",
    action: "connect.employer.hired",
    targetType: "connection",
    targetId: input.connectionId,
    summary: `An employer recorded a hire starting ${input.startDate}.`,
    metadata: { applicationId, hourlyWage: input.hourlyWage },
  });

  return { applicationId };
}

/**
 * The Opportunity mirror plus the verified Application.
 *
 * INTERIM (design spec §12.5, owner decision D5). `Application.opportunityId`
 * is required and the placement bridge reads `application.opportunity` for the
 * queue item's job label, so a hire arriving through a JobLead needs an
 * Opportunity to hang off. Rather than fork the bridge, the lead is mirrored
 * once — marked in `notes` with OPPORTUNITY_MIRROR_MARKER so the rows are
 * findable when D5 retires Opportunity — and reused on any later hire from the
 * same lead. The marker goes in `description`; Opportunity has no notes column.
 */
async function createVerifiedApplication(input: {
  studentId: string;
  verifiedBy: string | null;
  lead: { id: string; title: string; location: string; employer: { name: string } };
}): Promise<string> {
  const existingOpportunity = await prismaAdmin.opportunity.findFirst({
    where: { description: { contains: `${OPPORTUNITY_MIRROR_MARKER}${input.lead.id}` } },
    select: { id: true },
  });

  const opportunityId =
    existingOpportunity?.id ??
    (
      await prismaAdmin.opportunity.create({
        data: {
          title: input.lead.title,
          company: input.lead.employer.name,
          location: input.lead.location,
          type: "job",
          status: "closed",
          // Opportunity has no `notes` column, so the marker lives in
          // `description` — the field an instructor reading the row sees.
          description: `${OPPORTUNITY_MIRROR_MARKER}${input.lead.id}`,
        },
        select: { id: true },
      })
    ).id;

  const now = new Date();
  const application = await prismaAdmin.application.upsert({
    where: { studentId_opportunityId: { studentId: input.studentId, opportunityId } },
    // Never downgrade an existing row: a student who had already recorded this
    // application keeps their own history, and only the verification is added.
    update: {
      status: "accepted",
      verificationStatus: OUTCOME_VERIFICATION.VERIFIED,
      verifiedBy: input.verifiedBy,
      verifiedAt: now,
    },
    create: {
      studentId: input.studentId,
      opportunityId,
      status: "accepted",
      appliedAt: now,
      verificationStatus: OUTCOME_VERIFICATION.VERIFIED,
      verifiedBy: input.verifiedBy,
      verifiedAt: now,
    },
    select: { id: true },
  });

  return application.id;
}

/** Prisma P2002 on the scheduled-slot partial unique index (see #194). */
function isScheduledSlotViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const names = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  if (names.includes("Appointment_advisorId_startsAt_scheduled_key")) return true;
  return names.includes("advisorId") && names.includes("startsAt");
}

/**
 * In-app notification from a request with no session at all.
 *
 * The two recipients need different clients, and getting this wrong is silent:
 *   - STAFF, from a sessionless context: `{ client: "admin" }`, the same path
 *     the crisis notifications take (PR #188). The helper resolves the
 *     recipient's role and refuses a non-staff id, so this branch cannot be
 *     pointed at a student.
 *   - the STUDENT: `withStudentRlsContext`, so the app-client insert resolves
 *     through `notification_access`'s own-row branch. Under `vq_app` with no
 *     context that write is simply rejected, and swallowing the rejection is
 *     how the F62 class of bug stayed invisible for months.
 *
 * Never throws: the transition has already committed, and a missing nudge is
 * not worth failing the employer's answer over.
 */
async function notifyStudent(
  studentId: string,
  payload: { type: string; title: string; body?: string },
) {
  try {
    await withStudentRlsContext(studentId, () => sendNotification(studentId, payload));
  } catch (error) {
    logger.warn("Connect notification to student not delivered", { error: String(error) });
  }
}

async function notifyStaff(
  userId: string,
  payload: { type: string; title: string; body?: string },
) {
  try {
    await sendNotification(userId, payload, { client: "admin" });
  } catch (error) {
    logger.warn("Connect notification to staff not delivered", {
      actorId: userId,
      error: String(error),
    });
  }
}
