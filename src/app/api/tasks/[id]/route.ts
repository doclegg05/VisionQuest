import { NextResponse } from "next/server";
import { isTaskStatus, syncStudentAlerts } from "@/lib/advising";
import { withAuth, isStaffRole } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

export const PATCH = withAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = await req.json();
  const nextStatus = typeof body.status === "string" ? body.status.trim() : "";

  if (!isTaskStatus(nextStatus)) {
    return NextResponse.json({ error: "Invalid task status." }, { status: 400 });
  }

  const existing = await prisma.studentTask.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      studentId: true,
      completedAt: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (isStaffRole(session.role)) {
    await assertStaffCanManageStudent(session, existing.studentId);
  } else if (existing.studentId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const task = await prisma.studentTask.update({
    where: { id },
    data: {
      status: nextStatus,
      completedAt: nextStatus === "completed" ? existing.completedAt ?? new Date() : null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      completedAt: true,
      studentId: true,
      dueAt: true,
    },
  });

  await syncStudentAlerts(task.studentId);
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "task.updated",
    targetType: "task",
    targetId: task.id,
    summary: `Updated task "${task.title}" to ${task.status}.`,
    metadata: {
      studentId: task.studentId,
      previousStatus: existing.status,
      nextStatus: task.status,
    },
  });

  return NextResponse.json({ task });
});
