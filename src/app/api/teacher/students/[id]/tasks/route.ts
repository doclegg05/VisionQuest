import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isTaskPriority, syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
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
  const priority = typeof body.priority === "string" ? body.priority.trim() : "normal";
  const dueAt = typeof body.dueAt === "string" && body.dueAt ? new Date(body.dueAt) : null;
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
      createdById: teacher.id,
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
    actorId: teacher.id,
    actorRole: teacher.role,
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

  return NextResponse.json({ task });
}
