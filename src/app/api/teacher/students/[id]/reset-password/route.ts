import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";

const teacherResetPasswordSchema = z.object({
  newPassword: z.string().min(6, "Password must be at least 6 characters").max(200, "Password must be 200 characters or fewer"),
});

// POST — reset a student's password
export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const { newPassword } = await parseBody(req, teacherResetPasswordSchema);

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
