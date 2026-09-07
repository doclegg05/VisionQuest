import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db";
import {
  verifyPasswordSafeWithStatus,
  hashPassword,
  normalizeStudentId,
  normalizeEmail,
  setSessionCookie,
  signMfaSessionToken,
  setMfaSessionCookie,
} from "@/lib/auth";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody, loginSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = clientIpBucket(req);
  const rl = await rateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, loginSchema);
  const login = body.studentId.trim();
  const password = body.password.trim();

  const isEmail = login.includes("@");
  const student = isEmail
    ? await prisma.student.findUnique({ where: { email: normalizeEmail(login) } })
    : await prisma.student.findUnique({ where: { studentId: normalizeStudentId(login) } });

  // Per-user rate limit — prevents distributed brute force against a single
  // account. The refusal is deliberately NOT a 429: this route is reachable
  // without a session, the login is not a secret, and the per-IP bucket is 10
  // while this one is 5 — so a distinct status on the sixth attempt told an
  // anonymous caller whether the account exists, for six cheap requests per
  // address (2026-09-06 hunt, follow-up 1). A locked account now answers
  // exactly like a wrong password and exactly like an unknown login, the
  // attempt is still counted above, and the limit itself is unchanged.
  // Precedent and identical reasoning: reset-password/questions/route.ts.
  let accountLocked = false;
  if (student) {
    const userRl = await rateLimit(`login:user:${student.id}`, 5, 15 * 60 * 1000);
    accountLocked = !userRl.success;
  }

  // Consolidate all failure cases into a single generic response to prevent account enumeration.
  // Do not distinguish between: no account found, OAuth-only account, wrong password, or inactive account.
  const isOAuthOnly = student && !student.passwordHash && student.authProvider === "google";
  // Always run the KDF to equalize timing and avoid an account-enumeration oracle.
  const { valid: passwordMatches, needsRehash } = verifyPasswordSafeWithStatus(
    password,
    student?.passwordHash ?? null,
  );
  const isInvalidCredentials =
    !student || !student.passwordHash || !passwordMatches || !student.isActive;

  if (accountLocked || isOAuthOnly || isInvalidCredentials) {
    // The response says nothing the caller could not already guess; the audit
    // log, which only staff read, keeps the three cases apart.
    const failureStudent = accountLocked || isOAuthOnly ? student : null;
    const action = accountLocked
      ? "auth.login_failed_rate_limited"
      : isOAuthOnly
        ? "auth.login_failed_oauth"
        : "auth.login_failed";
    await logAuditEvent({
      actorId: failureStudent?.id ?? null,
      actorRole: failureStudent?.role ?? null,
      action,
      targetType: "student",
      targetId: failureStudent?.id,
      summary: accountLocked
        ? `Failed login attempt for "${login}" — refused, per-account attempt limit reached.`
        : `Failed login attempt for "${login}".`,
      metadata: { ip },
    });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Silent migration: if the stored hash used the legacy PBKDF2 format,
  // rehash with the current scrypt format. Failures here must not block
  // login — the user is already authenticated with the legacy hash.
  if (needsRehash && student) {
    try {
      const { hash: newHash } = hashPassword(password);
      await prisma.student.update({
        where: { id: student.id },
        data: { passwordHash: newHash },
      });
    } catch (err) {
      logger.warn("Password rehash failed", { student: studentLogKey(student.id), error: String(err) });
    }
  }

  // If MFA is enabled, set the short-lived MFA challenge cookie and return a
  // partial response. The cookie is httpOnly + scoped to /api/auth/mfa, so it
  // cannot be stolen via pre-session XSS and only travels to challenge routes.
  if (student.mfaEnabled) {
    const mfaSessionToken = signMfaSessionToken(student.id, student.role, student.sessionVersion);
    await setMfaSessionCookie(mfaSessionToken);

    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "auth.login_mfa_required",
      targetType: "student",
      targetId: student.id,
      summary: `Password verified for ${student.studentId} — MFA challenge required.`,
      metadata: { ip },
    });

    return NextResponse.json({
      requiresMfa: true,
    });
  }

  await setSessionCookie(student.id, student.role, student.sessionVersion);

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "auth.login",
    targetType: "student",
    targetId: student.id,
    summary: `Login successful for ${student.studentId}.`,
    metadata: { ip },
  });

  return NextResponse.json({
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      role: student.role,
    },
  });
});
