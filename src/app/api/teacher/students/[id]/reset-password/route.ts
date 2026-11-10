import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prismaAdmin } from "@/lib/db";
import { hashPassword, invalidateSessionCache } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
} from "@/lib/password-policy";
import { parseBody } from "@/lib/schemas";

const teacherResetPasswordSchema = z.object({
  // Trimmed, as sign-in trims what the student types: an untrimmed trailing space would lock them out.
  newPassword: z
    .string()
    .trim()
    .min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)
    .max(MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG_MESSAGE),
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

  const { hash } = await hashPassword(newPassword);
  // Reset tokens are own-only under RLS. After student authorization, use
  // one privileged transaction so a teacher reset actually revokes them.
  await prismaAdmin.$transaction([
    prismaAdmin.student.update({
      where: { id, role: "student" },
      data: {
        passwordHash: hash,
        // Staff typed this password, so staff know it. The student is held
        // to the change-password screen until they pick their own. The
        // version bump in the same write ends every session they have, so
        // no token from before the reset can go on without the claim.
        mustChangePassword: true,
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
