import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { isTaskPriority, syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;
  const body = await req.json();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const priority = typeof body.priority === "string" ? body.priority.trim() : "normal";
  const rawDueAt = typeof body.dueAt === "string" ? body.dueAt.trim() : "";
  // Date-only strings (YYYY-MM-DD) parse as UTC midnight, which can shift to
  // the previous day in negative-offset timezones. Append T12:00:00 to keep
  // the date stable across all timezones.
  const dueAt = rawDueAt
    ? new Date(rawDueAt.length === 10 ? `${rawDueAt}T12:00:00` : rawDueAt)
    : null;
  const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "Task title is required." }, { status: 400 });
  }

  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: "Due date is invalid." }, { status: 400 });
  }

  if (!isTaskPriority(priority)) {
    return NextResponse.json({ error: "Task priority is invalid." }, { status: 400 });
  }

  const student = await assertStaffCanManageStudent(session, studentId);

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  if (appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, studentId },
      select: { id: true },
    });
    if (!appointment) {
      return NextResponse.json({ error: "Appointment not found for this student." }, { status: 400 });
    }
  }

  const task = await prisma.studentTask.create({
    data: {
      studentId,
      createdById: session.id,
      appointmentId: appointmentId || null,
      title,
      description: description || null,
      dueAt,
      priority,
    },
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      priority: true,
    },
  });

  await syncStudentAlerts(studentId);
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "task.created",
    targetType: "student",
    targetId: studentId,
    summary: `Created follow-up task "${title}".`,
    metadata: {
      taskId: task.id,
      dueAt: task.dueAt?.toISOString() ?? null,
      priority: task.priority,
    },
  });

  // Push in-app notification to student
  sendNotification(studentId, {
    type: "task",
    title: "New task assigned",
    body: `"${title}"${dueAt ? ` — due ${dueAt.toLocaleDateString()}` : ""}`,
  }).catch((err) => logger.error("Failed to send notification", { error: String(err) }));

  return NextResponse.json({ task });
});
