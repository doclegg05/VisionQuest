import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";
import { generateBackupCodes, hashBackupCodes, verifyTotp } from "@/lib/mfa";
import { rateLimit } from "@/lib/rate-limit";

const backupCodeRegenerationSchema = z.object({
  token: z.string().length(6, "Token must be exactly 6 digits.").regex(/^\d{6}$/, "Token must be 6 digits."),
});

export const POST = withTeacherAuth(async (session, req: NextRequest) => {
  const rl = await rateLimit(`mfa-backup:${session.id}`, 3, 5 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, backupCodeRegenerationSchema);

  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      studentId: true,
      role: true,
      mfaEnabled: true,
      mfaSecret: true,
      mfaLastUsedCounter: true,
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (!student.mfaEnabled || !student.mfaSecret) {
    return NextResponse.json({ error: "MFA is not enabled on this account." }, { status: 400 });
  }

  const { valid: isValid, counter } = verifyTotp(student.mfaSecret, body.token, student.mfaLastUsedCounter);
  if (!isValid) {
    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "mfa.backup_codes_regeneration_failed",
      targetType: "student",
      targetId: student.id,
      summary: `Backup code regeneration failed for ${student.studentId} — invalid token.`,
    });

    return NextResponse.json({ error: "Invalid MFA code." }, { status: 401 });
  }

  const backupCodes = generateBackupCodes();

  await prisma.student.update({
    where: { id: student.id },
    data: {
      mfaBackupCodes: hashBackupCodes(backupCodes),
      ...(counter != null ? { mfaLastUsedCounter: counter } : {}),
    },
  });

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "mfa.backup_codes_regenerated",
    targetType: "student",
    targetId: student.id,
    summary: `Backup codes regenerated for ${student.studentId}.`,
  });

  return NextResponse.json({
    backupCodes,
    backupCodesRemaining: backupCodes.length,
  });
});
