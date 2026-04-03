import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { generateMfaSecret, generateTotpUri } from "@/lib/mfa";

/**
 * POST /api/auth/mfa/setup
 *
 * Generates a new MFA secret and returns the TOTP URI for authenticator app setup.
 * Requires auth (teacher/admin only). Does NOT enable MFA — just provides setup data.
 * The secret is temporarily stored encrypted on the student record (mfaEnabled remains false).
 * The client must call /api/auth/mfa/verify with a valid token to finalize setup.
 */
export const POST = withTeacherAuth(async (session) => {
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, mfaEnabled: true, studentId: true, role: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (student.mfaEnabled) {
    return NextResponse.json(
      { error: "MFA is already enabled on this account. Disable it first to reconfigure." },
      { status: 409 },
    );
  }

  const { secret, encrypted } = generateMfaSecret();
  const email = student.email || student.studentId;
  const totpUri = generateTotpUri(secret, email);

  // Store the encrypted secret provisionally (mfaEnabled stays false until verified)
  await prisma.student.update({
    where: { id: student.id },
    data: { mfaSecret: encrypted },
  });

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "mfa.setup_started",
    targetType: "student",
    targetId: student.id,
    summary: `MFA setup initiated for ${student.studentId}.`,
  });

  return NextResponse.json({
    totpUri,
    secret, // Displayed once for manual entry into authenticator app
  });
});
