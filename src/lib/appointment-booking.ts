import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Durable write for a student self-booking (POST /api/appointments/book).
 *
 * The database is the arbiter of a slot. Migration 20260902140000 adds a
 * partial unique index on (advisorId, startsAt) WHERE status = 'scheduled',
 * so two students racing for one slot cannot both insert (2026-09-01 review
 * F27 / API-U-02). The loser surfaces as Prisma P2002 and is returned as
 * `slot_taken` rather than thrown, so the route can answer 409 without ever
 * touching the raw Prisma error.
 */

export type BookableSlot = {
  startsAt: string;
  endsAt: string;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
};

export type StudentBookingInput = {
  studentId: string;
  advisorId: string;
  title: string;
  description: string | null;
  slot: BookableSlot;
};

const BOOKED_APPOINTMENT_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  advisor: {
    select: {
      displayName: true,
    },
  },
} satisfies Prisma.AppointmentSelect;

export type BookedAppointment = Prisma.AppointmentGetPayload<{
  select: typeof BOOKED_APPOINTMENT_SELECT;
}>;

export type StudentBookingResult =
  | { outcome: "booked"; appointment: BookedAppointment }
  | { outcome: "slot_taken" };

/** Partial unique index from migration 20260902140000. */
export const SCHEDULED_SLOT_INDEX = "Appointment_advisorId_startsAt_scheduled_key";
const SCHEDULED_SLOT_FIELDS = ["advisorId", "startsAt"] as const;

export async function createStudentBooking(input: StudentBookingInput): Promise<StudentBookingResult> {
  try {
    const appointment = await prisma.appointment.create({
      data: {
        studentId: input.studentId,
        advisorId: input.advisorId,
        title: input.title,
        description: input.description,
        startsAt: new Date(input.slot.startsAt),
        endsAt: new Date(input.slot.endsAt),
        locationType: input.slot.locationType,
        locationLabel: input.slot.locationLabel,
        meetingUrl: input.slot.meetingUrl,
        bookingSource: "student",
        status: "scheduled",
      },
      select: BOOKED_APPOINTMENT_SELECT,
    });
    return { outcome: "booked", appointment };
  } catch (error) {
    if (isScheduledSlotViolation(error)) {
      return { outcome: "slot_taken" };
    }
    throw error;
  }
}

/**
 * Prisma P2002 = unique-constraint violation, duck-typed like
 * sage/agent/confirmation-use.ts. Only the scheduled-slot index counts as
 * "slot taken"; a P2002 on any other constraint propagates. `meta.target`
 * carries the index name (string, or inside an array) or, when quaint parses
 * the Postgres DETAIL line, the field names, so all three shapes match.
 */
function isScheduledSlotViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code !== "P2002") return false;

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const names = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];

  if (names.includes(SCHEDULED_SLOT_INDEX)) return true;
  return SCHEDULED_SLOT_FIELDS.every((field) => names.includes(field));
}
