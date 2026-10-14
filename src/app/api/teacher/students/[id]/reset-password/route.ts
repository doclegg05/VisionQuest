import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prismaAdmin } from "@/lib/db";
import { hashPassword, invalidateSessionCache } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";

const teacherResetPasswordSchema = z.object({
  newPassword: z.string().min(12, "Password must be at least 12 characters").max(200, "Password must be 200 characters or fewer"),
});

// POST — reset a student's password
export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: identifier } = await params;
  const { newPassword } = await parseBody(req, teacherResetPasswordSchema);

  const student = await assertStaffCanManageStudent(session, identifier);
  const id = student.id;
  if (student.role !== "student") {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { hash } = hashPassword(newPassword);
  // Reset tokens are own-only under RLS. After student authorization, use
  // one privileged transaction so a teacher reset actually revokes them.
  await prismaAdmin.$transaction([
    prismaAdmin.student.update({
      where: { id, role: "student" },
      data: {
        passwordHash: hash,
        sessionVersion: { increment: 1 },
      },
    }),
    prismaAdmin.passwordResetToken.deleteMany({
      where: { studentId: id },
    }),
  ]);
  invalidateSessionCache(id);

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
