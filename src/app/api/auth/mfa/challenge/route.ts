import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  verifyMfaSessionToken,
  setSessionCookie,
  getMfaSessionToken,
  clearMfaSessionCookie,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { consumeBackupCode, verifyTotp } from "@/lib/mfa";

const mfaChallengeSchema = z.object({
  token: z.string().min(6, "MFA code is required.").max(32, "MFA code is too long."),
  // Backwards-compat: old clients may still post the token in body. New
  // clients rely on the httpOnly cookie set at login time.
  mfaSessionToken: z.string().optional(),
});

/**
 * POST /api/auth/mfa/challenge
 *
 * Second-factor verification during login.
 * Called after successful password auth when mfaEnabled=true.
 * Requires the short-lived mfaSessionToken (proves password was correct) plus
 * either a valid TOTP code or a one-time backup code. On success, issues the
 * real session JWT cookie.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Rate limit MFA challenge attempts (5 attempts per 5 minutes per IP)
  const rl = await rateLimit(`mfa-challenge:${ip}`, 5, 5 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many MFA attempts. Please try again later." },
      { status: 429 },
    );
  }

  const body = await parseBody(req, mfaChallengeSchema);

  // Prefer the httpOnly cookie set at login. Fall back to the body-posted
  // token so older clients keep working during rollout.
  const cookieToken = await getMfaSessionToken();
  const mfaSessionToken = cookieToken ?? body.mfaSessionToken;

  if (!mfaSessionToken) {
    return NextResponse.json(
      { error: "MFA session expired or invalid. Please log in again." },
      { status: 401 },
    );
  }

  // Verify the MFA session token (short-lived JWT from password auth step)
  const claims = verifyMfaSessionToken(mfaSessionToken);
  if (!claims) {
    return NextResponse.json(
      { error: "MFA session expired or invalid. Please log in again." },
      { status: 401 },
    );
  }

  const student = await prisma.student.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      studentId: true,
      role: true,
      sessionVersion: true,
      isActive: true,
      mfaEnabled: true,
      mfaSecret: true,
      mfaBackupCodes: true,
      mfaLastUsedCounter: true,
    },
  });

  if (!student || !student.isActive || !student.mfaEnabled || !student.mfaSecret) {
    return NextResponse.json({ error: "Invalid MFA session." }, { status: 401 });
  }

  // Verify session version matches (prevents use after password reset / session invalidation)
  if (student.sessionVersion !== claims.sv) {
    return NextResponse.json(
      { error: "Session invalidated. Please log in again." },
      { status: 401 },
    );
  }

  const isTotpToken = /^\d{6}$/.test(body.token);
  const totpResult = isTotpToken
    ? verifyTotp(student.mfaSecret, body.token, student.mfaLastUsedCounter)
    : { valid: false, counter: null };
  const isValidTotp = totpResult.valid;
  const remainingBackupCodes = isValidTotp
    ? null
    : consumeBackupCode(student.mfaBackupCodes, body.token);
  const usedBackupCode = remainingBackupCodes !== null;
  const isValid = isValidTotp || usedBackupCode;

  if (!isValid) {
    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "mfa.challenge_failed",
      targetType: "student",
      targetId: student.id,
      summary: `MFA challenge failed for ${student.studentId}.`,
      metadata: { ip },
    });

    return NextResponse.json({ error: "Invalid MFA code." }, { status: 401 });
  }

  // MFA verified — update timestamp and issue the real session
  await prisma.student.update({
    where: { id: student.id },
    data: {
      mfaVerifiedAt: new Date(),
      ...(usedBackupCode ? { mfaBackupCodes: remainingBackupCodes } : {}),
      ...(isValidTotp && totpResult.counter != null ? { mfaLastUsedCounter: totpResult.counter } : {}),
    },
  });

  await setSessionCookie(student.id, student.role, student.sessionVersion);
  // Single-use cookie — clear once the real session is issued.
  await clearMfaSessionCookie();

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "mfa.challenge_success",
    targetType: "student",
    targetId: student.id,
    summary: `MFA challenge passed for ${student.studentId}.`,
    metadata: {
      ip,
      method: usedBackupCode ? "backup_code" : "totp",
    },
  });

  return NextResponse.json({
    backupCodeUsed: usedBackupCode,
    backupCodesRemaining: usedBackupCode ? remainingBackupCodes.length : student.mfaBackupCodes.length,
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.studentId, // Minimal — matches login response shape
      role: student.role,
    },
  });
});
