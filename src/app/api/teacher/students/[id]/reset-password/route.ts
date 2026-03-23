import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

// POST — reset a student's password
export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const { newPassword } = await req.json();

  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const student = await assertStaffCanManageStudent(session, id);
  if (!student || student.role === "teacher") {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { hash } = hashPassword(newPassword);
  await prisma.$transaction([
    prisma.student.update({
      where: { id },
      data: {
        passwordHash: hash,
        sessionVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { studentId: id },
    }),
  ]);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.password.reset",
    targetType: "student",
    targetId: id,
    summary: `Teacher reset the password for ${student.studentId}.`,
    metadata: {
      studentId: student.studentId,
    },
  });

  return NextResponse.json({ ok: true });
});
