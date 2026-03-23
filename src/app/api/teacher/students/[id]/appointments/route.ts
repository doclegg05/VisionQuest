import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import {
  APPOINTMENT_STATUSES,
  isAvailabilityLocationType,
  sendAppointmentConfirmation,
  syncStudentAlerts,
} from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";

function isValidUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;
  const body = await req.json();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const locationType = typeof body.locationType === "string" ? body.locationType.trim() : "virtual";
  const locationLabel = typeof body.locationLabel === "string" ? body.locationLabel.trim() : "";
  const meetingUrl = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const followUpRequired = Boolean(body.followUpRequired);
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  const endsAt = typeof body.endsAt === "string" ? new Date(body.endsAt) : null;

  if (!title || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: "Title, start, and end time are required." }, { status: 400 });
  }

  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  }

  if (!isAvailabilityLocationType(locationType)) {
    return NextResponse.json({ error: "Invalid location type." }, { status: 400 });
  }

  if (!isValidUrl(meetingUrl)) {
    return NextResponse.json({ error: "Meeting URL must be valid." }, { status: 400 });
  }

  const student = await assertStaffCanManageStudent(session, studentId);

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const appointment = await prisma.appointment.create({
    data: {
      studentId,
      advisorId: session.id,
      title,
      description: description || null,
      startsAt,
      endsAt,
      locationType,
      locationLabel: locationLabel || null,
      meetingUrl: meetingUrl || null,
      notes: notes || null,
      followUpRequired,
      bookingSource: "teacher",
      status: APPOINTMENT_STATUSES[0],
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
    },
  });

  await syncStudentAlerts(studentId);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "appointment.created",
    targetType: "student",
    targetId: studentId,
    summary: `Scheduled appointment "${title}".`,
    metadata: {
      appointmentId: appointment.id,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
    },
  });

  try {
    await sendAppointmentConfirmation(appointment.id);
  } catch (error) {
    logger.error("Failed to send appointment confirmation", { error: String(error) });
  }

  // Push in-app notification to student
  sendNotification(studentId, {
    type: "appointment",
    title: "New appointment scheduled",
    body: `"${title}" on ${startsAt.toLocaleDateString()}`,
  }).catch((err) => logger.error("Failed to send notification", { error: String(err) }));

  return NextResponse.json({ appointment });
});
