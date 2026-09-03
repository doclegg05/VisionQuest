import { NextRequest, NextResponse } from "next/server";
import {
  hashPassword,
  setSessionCookie,
  signMfaSessionToken,
  setMfaSessionCookie,
} from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/db";
import { hashPasswordResetToken } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody, resetPasswordSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`reset-password:${ip}`, 10, 60 * 60 * 1000);

  if (!rl.success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, resetPasswordSchema);
  const token = body.token.trim();
  const password = body.password.trim();

  const tokenHash = hashPasswordResetToken(token);
  const now = new Date();
  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      student: {
        select: {
          id: true,
          role: true,
          sessionVersion: true,
        },
      },
    },
  });

  if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt <= now) {
    return NextResponse.json({ error: "This reset link has expired or has already been used." }, { status: 400 });
  }

  const { hash } = hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const markedUsed = await tx.passwordResetToken.updateMany({
      where: {
        id: resetRecord.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (markedUsed.count !== 1) {
      throw new Error("Reset token is no longer valid.");
    }

    const student = await tx.student.update({
      where: { id: resetRecord.student.id },
      data: {
        passwordHash: hash,
        sessionVersion: { increment: 1 },
      },
      select: {
        id: true,
        role: true,
        sessionVersion: true,
        mfaEnabled: true,
      },
    });

    await tx.passwordResetToken.deleteMany({
      where: { studentId: resetRecord.student.id },
    });

    return {
      studentId: student.id,
      role: student.role,
      sessionVersion: student.sessionVersion,
      mfaEnabled: student.mfaEnabled,
    };
  });

  // Mailbox control must not skip the second factor (security finding F66).
  // Same contract as the login route: an MFA-enabled account gets the
  // short-lived, path-scoped challenge cookie and no session until the
  // challenge route verifies a TOTP or backup code. The token carries the
  // sessionVersion bumped above, or the challenge route would reject it.
  if (result.mfaEnabled) {
    const mfaSessionToken = signMfaSessionToken(result.studentId, result.role, result.sessionVersion);
    await setMfaSessionCookie(mfaSessionToken);

    await logAuditEvent({
      actorId: result.studentId,
      actorRole: result.role,
      action: "auth.password.reset",
      targetType: "student",
      targetId: result.studentId,
      summary: "Student reset their password with an emailed recovery link; MFA challenge required before sign-in.",
      metadata: { mfaRequired: true },
    });
    logger.info("Password reset completed; MFA challenge required before a session is issued", {
      student: studentLogKey(result.studentId),
    });

    return NextResponse.json({ requiresMfa: true });
  }

  await setSessionCookie(result.studentId, result.role, result.sessionVersion);

  await logAuditEvent({
    actorId: result.studentId,
    actorRole: result.role,
    action: "auth.password.reset",
    targetType: "student",
    targetId: result.studentId,
    summary: "Student reset their password with an emailed recovery link.",
    metadata: { mfaRequired: false },
  });

  return NextResponse.json({ ok: true });
});
