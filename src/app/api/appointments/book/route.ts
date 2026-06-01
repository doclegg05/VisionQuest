import { NextResponse } from "next/server";
import { listBookableAdvisors, sendAppointmentConfirmation, syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api-error";
import { parseBody, bookAppointmentSchema } from "@/lib/schemas";

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "student") {
    return NextResponse.json({ error: "Only students can self-book appointments." }, { status: 403 });
  }

  const { advisorId, startsAt, title, description } = await parseBody(req, bookAppointmentSchema);

  const advisors = await listBookableAdvisors({
    days: 21,
    maxSlotsPerAdvisor: 100,
    minimumLeadMinutes: 60,
  });

  const advisor = advisors.find((entry) => entry.advisorId === advisorId);
  const slot = advisor?.slots.find((entry) => entry.startsAt === startsAt);

  if (!advisor || !slot) {
    return NextResponse.json({ error: "That time slot is no longer available." }, { status: 409 });
  }

  const appointment = await prisma.appointment.create({
    data: {
      studentId: session.id,
      advisorId,
      title: title || "Advising session",
      description: description || null,
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
      locationType: slot.locationType,
      locationLabel: slot.locationLabel,
      meetingUrl: slot.meetingUrl,
      bookingSource: "student",
      status: "scheduled",
    },
    select: {
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
    },
  });

  await syncStudentAlerts(session.id);
  await logAuditEvent({
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
  });

  try {
    await sendAppointmentConfirmation(appointment.id);
  } catch (error) {
    logger.error("Failed to send appointment confirmation", { error: String(error) });
  }

  return NextResponse.json({ appointment });
});
