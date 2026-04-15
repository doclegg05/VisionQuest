import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";
import { verifyTotp } from "@/lib/mfa";
import { rateLimit } from "@/lib/rate-limit";

const mfaDisableSchema = z.object({
  token: z.string().length(6, "Token must be exactly 6 digits.").regex(/^\d{6}$/, "Token must be 6 digits."),
});

/**
 * POST /api/auth/mfa/disable
 *
 * Disables MFA on the authenticated account.
 * Requires a valid TOTP code to confirm the user controls the authenticator.
 * Clears mfaSecret, mfaEnabled, mfaBackupCodes, and mfaVerifiedAt.
 */
export const POST = withTeacherAuth(async (session, req: NextRequest) => {
  const rl = await rateLimit(`mfa-disable:${session.id}`, 5, 5 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, mfaDisableSchema);

  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { id: true, studentId: true, role: true, mfaSecret: true, mfaEnabled: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (!student.mfaEnabled || !student.mfaSecret) {
    return NextResponse.json({ error: "MFA is not enabled on this account." }, { status: 400 });
  }

  const isValid = verifyTotp(student.mfaSecret, body.token);
  if (!isValid) {
    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "mfa.disable_failed",
      targetType: "student",
      targetId: student.id,
      summary: `MFA disable attempt failed for ${student.studentId} — invalid token.`,
    });

    return NextResponse.json({ error: "Invalid MFA code." }, { status: 401 });
  }

  await prisma.student.update({
    where: { id: student.id },
    data: {
      mfaSecret: null,
      mfaEnabled: false,
      mfaBackupCodes: [],
      mfaVerifiedAt: null,
    },
  });

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "mfa.disabled",
    targetType: "student",
    targetId: student.id,
    summary: `MFA disabled for ${student.studentId}.`,
  });

  return NextResponse.json({ disabled: true });
});
