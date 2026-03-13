import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listBookableAdvisors, sendAppointmentConfirmation, syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "student") {
    return NextResponse.json({ error: "Only students can self-book appointments." }, { status: 403 });
  }

  const body = await req.json();
  const advisorId = typeof body.advisorId === "string" ? body.advisorId.trim() : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!advisorId || !startsAt) {
    return NextResponse.json({ error: "Advisor and time slot are required." }, { status: 400 });
  }

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
}
