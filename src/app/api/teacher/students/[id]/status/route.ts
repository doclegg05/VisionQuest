import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { invalidateSessionCache } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { generateStudentArchive } from "@/lib/student-archive";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

// PATCH — toggle a student's active status
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: identifier } = await params;
  const body = await req.json();
  const isActive = body.isActive;

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }

  const student = await assertStaffCanManageStudent(session, identifier);
  const id = student.id;
  if (student.role !== "student") {
    return NextResponse.json({ error: "Cannot change status of staff accounts" }, { status: 403 });
  }

  // Increment sessionVersion on deactivation to force logout
  await prisma.student.update({
    where: { id },
    data: {
      isActive,
      ...(isActive === false ? { sessionVersion: { increment: 1 } } : {}),
    },
  });

  invalidateSessionCache(id);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: isActive ? "teacher.student.reactivate" : "teacher.student.deactivate",
    targetType: "student",
    targetId: id,
    summary: `${isActive ? "Reactivated" : "Deactivated"} student ${student.studentId}.`,
  });

  // Auto-archive on deactivation (fire-and-forget)
  if (!isActive) {
    generateStudentArchive(id, session.id).catch((err) =>
      logger.error("Auto-archive on deactivation failed", { student: studentLogKey(id), error: String(err) }),
    );
  }

  return NextResponse.json({ ok: true, isActive });
});
