import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

// PATCH — toggle a student's active status
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = await req.json();
  const isActive = body.isActive;

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, studentId: true, role: true, isActive: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (student.role === "teacher") {
    return NextResponse.json({ error: "Cannot change status of teacher accounts" }, { status: 403 });
  }

  // Increment sessionVersion on deactivation to force logout
  await prisma.student.update({
    where: { id },
    data: {
      isActive,
      ...(isActive === false ? { sessionVersion: { increment: 1 } } : {}),
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: isActive ? "teacher.student.reactivate" : "teacher.student.deactivate",
    targetType: "student",
    targetId: id,
    summary: `${isActive ? "Reactivated" : "Deactivated"} student ${student.studentId}.`,
  });

  return NextResponse.json({ ok: true, isActive });
});
