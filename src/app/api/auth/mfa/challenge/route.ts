import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/db";
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
import { claimBackupCode, verifyTotp } from "@/lib/mfa";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

const mfaChallengeSchema = z.object({
  token: z.string().min(6, "MFA code is required.").max(32, "MFA code is too long."),
  // Backwards-compat: old clients may still post the token in body. New
  // clients rely on the httpOnly cookie set at login time.
  mfaSessionToken: z.string().optional(),
});

/**
 * Per-account bounds, matching login's per-user limit (login/route.ts). The
 * window outlives the five-minute challenge cookie on purpose: a re-login
 * mints a fresh cookie and must not mint a fresh budget of code guesses.
 */
const ACCOUNT_LIMIT_ATTEMPTS = 5;
const ACCOUNT_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOCKED_MESSAGE =
  "Too many code tries for this account. Wait 15 minutes, then log in and try again.";

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

  // Per-account limit, keyed on the challenged account rather than the
  // caller's address: guesses spread across IPs, or repeated through
  // re-logins that each mint a fresh challenge cookie, share one counter.
  // Runs before the account row is read so a locked account costs no query.
  const accountRl = await rateLimit(
    `mfa-challenge:user:${claims.sub}`,
    ACCOUNT_LIMIT_ATTEMPTS,
    ACCOUNT_LIMIT_WINDOW_MS,
  );
  if (!accountRl.success) {
    logger.warn("MFA challenge locked out", { student: studentLogKey(claims.sub) });
    await logAuditEvent({
      actorId: claims.sub,
      actorRole: claims.role,
      action: "mfa.challenge_locked_out",
      targetType: "student",
      targetId: claims.sub,
      summary: "MFA challenge locked out after too many code attempts.",
      metadata: { ip },
    });
    return NextResponse.json({ error: ACCOUNT_LOCKED_MESSAGE }, { status: 429 });
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

  // A backup code is spent by one conditional write, so the same code posted
  // twice at once is honoured once (SEC-02). A refused claim is a failed
  // attempt, whichever request lost the race.
  const backupClaim = totpResult.valid
    ? null
    : await claimBackupCode(prisma, student.id, student.mfaBackupCodes, body.token);
  const usedBackupCode = backupClaim?.claimed === true;

  if (!totpResult.valid && !usedBackupCode) {
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

  if (totpResult.valid) {
    // TOTP path: record the accepted counter so the same code cannot be replayed.
    await prisma.student.update({
      where: { id: student.id },
      data: {
        mfaVerifiedAt: new Date(),
        ...(totpResult.counter != null ? { mfaLastUsedCounter: totpResult.counter } : {}),
      },
    });
  }

  const backupCodesRemaining = backupClaim?.claimed
    ? backupClaim.remaining.length
    : student.mfaBackupCodes.length;

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
    backupCodesRemaining,
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.studentId, // Minimal — matches login response shape
      role: student.role,
    },
  });
});
