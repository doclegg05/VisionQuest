import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { isAppointmentStatus, syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = await req.json();
  const nextStatus = typeof body.status === "string" ? body.status.trim() : null;
  const nextNotes = typeof body.notes === "string" ? body.notes.trim() : null;

  if (nextStatus && !isAppointmentStatus(nextStatus)) {
    return NextResponse.json({ error: "Invalid appointment status." }, { status: 400 });
  }

  if (!nextStatus && nextNotes === null) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const existing = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
      title: true,
      status: true,
      notes: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: nextStatus ?? undefined,
      notes: nextNotes === null ? undefined : nextNotes || null,
      reminderSentAt: nextStatus === "scheduled" ? null : undefined,
    },
    select: {
      id: true,
      studentId: true,
      title: true,
      status: true,
      notes: true,
      startsAt: true,
      endsAt: true,
    },
  });

  await syncStudentAlerts(appointment.studentId);
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "appointment.updated",
    targetType: "appointment",
    targetId: appointment.id,
    summary: `Updated appointment "${appointment.title}".`,
    metadata: {
      studentId: appointment.studentId,
      previousStatus: existing.status,
      nextStatus: appointment.status,
    },
  });

  return NextResponse.json({ appointment });
});
