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
    if (isUniqueViolation(error)) {
      return { outcome: "slot_taken" };
    }
    throw error;
  }
}

/**
 * Prisma P2002 = unique-constraint violation. Appointment's only unique
 * index besides the primary key is the partial slot index, so any P2002 on
 * create means the slot. If another unique index is ever added to the
 * model, inspect `meta.target` here before treating P2002 as a slot clash.
 * Duck-typed like sage/agent/confirmation-use.ts and progression/events.ts.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
