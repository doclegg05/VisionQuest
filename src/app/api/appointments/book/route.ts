import { NextResponse } from "next/server";
import { listBookableAdvisors, sendAppointmentConfirmation, syncStudentAlerts } from "@/lib/advising";
import { createStudentBooking } from "@/lib/appointment-booking";
import { logAuditEvent } from "@/lib/audit";
import { withAuth } from "@/lib/api-error";
import { studentLogKey } from "@/lib/log-keys";
import { redactContactInfo } from "@/lib/log-redaction";
import { logger } from "@/lib/logger";
import { parseBody, bookAppointmentSchema } from "@/lib/schemas";

const DEFAULT_TITLE = "Advising session";
const SLOT_NOT_OPEN_MESSAGE = "That time slot is no longer available.";
const SLOT_JUST_TAKEN_MESSAGE = "That time was just taken. Pick another time.";

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "student") {
    return NextResponse.json({ error: "Only students can self-book appointments." }, { status: 403 });
  }

  const { advisorId, startsAt, title, description } = await parseBody(req, bookAppointmentSchema);

  // Fast path only: refuse slots that are not open. Two students can both
  // pass this read; the partial unique index behind createStudentBooking
  // decides who gets the slot (review F27 / API-U-02).
  const advisors = await listBookableAdvisors({
    days: 21,
    maxSlotsPerAdvisor: 100,
    minimumLeadMinutes: 60,
  });

  const advisor = advisors.find((entry) => entry.advisorId === advisorId);
  const slot = advisor?.slots.find((entry) => entry.startsAt === startsAt);

  if (!advisor || !slot) {
    return NextResponse.json({ error: SLOT_NOT_OPEN_MESSAGE }, { status: 409 });
  }

  // Durable write first. Nothing after this point may turn a saved booking
  // into a failure response (review F26 / API-U-01).
  const result = await createStudentBooking({
    studentId: session.id,
    advisorId,
    title: title || DEFAULT_TITLE,
    description: description || null,
    slot,
  });

  switch (result.outcome) {
    case "slot_taken":
      return NextResponse.json({ error: SLOT_JUST_TAKEN_MESSAGE }, { status: 409 });
    case "booked":
      break;
    default: {
      const unhandled: never = result;
      throw new Error(`Unhandled booking outcome: ${JSON.stringify(unhandled)}`);
    }
  }

  const { appointment } = result;
  const logContext = { appointment: appointment.id, student: studentLogKey(session.id) };

  await afterBooking("student alert sync", logContext, () => syncStudentAlerts(session.id));
  await afterBooking("audit log", logContext, () =>
    logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "appointment.booked",
      targetType: "appointment",
      targetId: appointment.id,
      summary: `Booked "${appointment.title}" with ${appointment.advisor.displayName}.`,
      metadata: {
        advisorId,
        startsAt: appointment.startsAt.toISOString(),
        bookingSource: "student",
      },
    }),
  );
  await afterBooking("confirmation email", logContext, () => sendAppointmentConfirmation(appointment.id));

  return NextResponse.json({ appointment }, { status: 201 });
});

/**
 * Best-effort side effect after the booking is saved. A failure is logged
 * and swallowed so the student still hears that the booking went through;
 * each step runs even when the one before it failed.
 */
async function afterBooking(
  step: string,
  context: Record<string, unknown>,
  effect: () => Promise<unknown>,
): Promise<void> {
  try {
    await effect();
  } catch (error) {
    logger.warn(`Appointment saved but ${step} failed`, {
      ...context,
      error: redactContactInfo(String(error)),
    });
  }
}
