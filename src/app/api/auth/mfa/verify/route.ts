import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";
import { verifyTotp, generateBackupCodes } from "@/lib/mfa";

const mfaVerifySchema = z.object({
  token: z.string().length(6, "Token must be exactly 6 digits.").regex(/^\d{6}$/, "Token must be 6 digits."),
});

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies a TOTP token during initial MFA setup.
 * If valid, enables MFA on the account (sets mfaEnabled=true).
 * Returns one-time-display backup codes.
 */
export const POST = withTeacherAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, mfaVerifySchema);

  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { id: true, studentId: true, role: true, mfaSecret: true, mfaEnabled: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (student.mfaEnabled) {
    return NextResponse.json({ error: "MFA is already enabled." }, { status: 409 });
  }

  if (!student.mfaSecret) {
    return NextResponse.json(
      { error: "MFA setup has not been started. Call /api/auth/mfa/setup first." },
      { status: 400 },
    );
  }

  const isValid = verifyTotp(student.mfaSecret, body.token);
  if (!isValid) {
    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "mfa.setup_verify_failed",
      targetType: "student",
      targetId: student.id,
      summary: `MFA setup verification failed for ${student.studentId} — invalid token.`,
    });

    return NextResponse.json({ error: "Invalid token. Please try again." }, { status: 401 });
  }

  // Enable MFA
  await prisma.student.update({
    where: { id: student.id },
    data: {
      mfaEnabled: true,
      mfaVerifiedAt: new Date(),
    },
  });

  const backupCodes = generateBackupCodes();

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "mfa.enabled",
    targetType: "student",
    targetId: student.id,
    summary: `MFA enabled for ${student.studentId}.`,
  });

  return NextResponse.json({
    enabled: true,
    backupCodes, // One-time display — the client must instruct the user to save these
  });
});
