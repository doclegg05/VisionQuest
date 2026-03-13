import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  APPOINTMENT_STATUSES,
  isAvailabilityLocationType,
  sendAppointmentConfirmation,
  syncStudentAlerts,
} from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

function isValidUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const student = await prisma.student.findFirst({
    where: {
      id: studentId,
      role: "student",
    },
    select: { id: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const appointment = await prisma.appointment.create({
    data: {
      studentId,
      advisorId: teacher.id,
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
    actorId: teacher.id,
    actorRole: teacher.role,
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
    console.error("Failed to send appointment confirmation:", error);
  }

  return NextResponse.json({ appointment });
}
