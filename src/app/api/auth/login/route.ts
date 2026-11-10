import { createHmac } from "node:crypto";
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
import { rateLimit, refundRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody, loginSchema } from "@/lib/schemas";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { getJwtSecret } from "@/lib/session-token";

/** One window for both sign-in limits. The failure messages name it in minutes. */
const SIGN_IN_WINDOW_MINUTES = 15;
const SIGN_IN_WINDOW_MS = SIGN_IN_WINDOW_MINUTES * 60 * 1000;

/**
 * FAILED sign-ins one network address may make per window. A right password
 * gives its unit back, so a classroom of 30 on one address can all sign in;
 * 30 leaves each of them one mistyped try. This bucket slows one address
 * guessing across many accounts. It is a courtesy limit: the address comes
 * from `X-Forwarded-For`, which a caller can set (src/lib/client-ip.ts).
 */
const NETWORK_FAILED_SIGN_IN_LIMIT = 30;

/**
 * Sign-in attempts on one account per window, right or wrong, from any
 * address. This is the brute-force control, and nothing gives its units back.
 */
const ACCOUNT_SIGN_IN_LIMIT = 5;

/**
 * The one answer for every failed sign-in: unknown login, wrong password,
 * locked, closed or Google-only account. One text, so the response never
 * says which it was.
 */
const SIGN_IN_FAILED_MESSAGE =
  "We could not sign you in. Check your username or email and your password, then try again. " +
  `After too many tries, wait ${SIGN_IN_WINDOW_MINUTES} minutes or ask your instructor for help.`;

const NETWORK_LIMIT_MESSAGE = `Too many sign-in tries from this location. Wait ${SIGN_IN_WINDOW_MINUTES} minutes, then try again, or ask your instructor for help.`;

/**
 * Per-login limiter key for a login that names no account. An HMAC of the
 * normalized login under the server's JWT secret: case and whitespace variants
 * share one bucket, the typed login never reaches the limiter table (the
 * storage key is only a plain sha256 of this, and logins are guessable), and
 * the `login:unknown:` namespace cannot collide with a real `login:user:<id>`.
 */
function unknownLoginLimiterKey(normalizedLogin: string): string {
  const digest = createHmac("sha256", getJwtSecret())
    .update(`login-limiter:${normalizedLogin}`)
    .digest("hex");
  return `login:unknown:${digest}`;
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = clientIpBucket(req);
  // Every attempt takes a unit first, in one atomic statement, so a burst of
  // guesses cannot race past the limit. A right password gives it back below.
  const networkKey = `login:${ip}`;
  const networkRl = await rateLimit(networkKey, NETWORK_FAILED_SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS);
  if (!networkRl.success) {
    return NextResponse.json({ error: NETWORK_LIMIT_MESSAGE }, { status: 429 });
  }

  const body = await parseBody(req, loginSchema);
  const login = body.studentId.trim();
  const password = body.password.trim();

  const isEmail = login.includes("@");
  const normalizedLogin = isEmail ? normalizeEmail(login) : normalizeStudentId(login);
  const student = isEmail
    ? await prisma.student.findUnique({ where: { email: normalizedLogin } })
    : await prisma.student.findUnique({ where: { studentId: normalizedLogin } });

  // Per-user rate limit — prevents distributed brute force against a single
  // account. The refusal is deliberately NOT a 429: this route is reachable
  // without a session, the login is not a secret, and the per-IP bucket is
  // larger than this one — so a distinct status on the sixth attempt told an
  // anonymous caller whether the account exists, for six cheap requests per
  // address (2026-09-06 hunt, follow-up 1). A locked account now answers
  // exactly like a wrong password and exactly like an unknown login, the
  // attempt is still counted above, and the limit itself is unchanged.
  // Precedent and identical reasoning: reset-password/questions/route.ts.
  //
  // The limiter round trip runs for unknown logins too (2026-10-22 scan, F12):
  // it ran only for real accounts, so they answered one database round trip
  // slower, which the dummy KDF below could not hide. A real account stays
  // keyed on its id, so its email and student-ID aliases share one budget. The
  // unknown-login key is computed on every request so both paths do the same
  // work and fail alike. An unknown login can never sign in, so its spent
  // bucket changes nothing it is told; only a real account counts as locked.
  const unknownLoginKey = unknownLoginLimiterKey(normalizedLogin);
  const userRl = await rateLimit(
    student ? `login:user:${student.id}` : unknownLoginKey,
    ACCOUNT_SIGN_IN_LIMIT,
    SIGN_IN_WINDOW_MS,
  );
  const accountLocked = student !== null && !userRl.success;

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
    return NextResponse.json({ error: SIGN_IN_FAILED_MESSAGE }, { status: 401 });
  }

  // Silent migration: if the stored hash used the legacy PBKDF2 format,
  // rehash with the current scrypt format. Failures here must not block
  // login — the user is already authenticated with the legacy hash.
  if (needsRehash && student) {
    try {
      const { hash: newHash } = hashPassword(password);
      // Never restore the old password over a concurrent reset/change.
      const migrated = await prisma.student.updateMany({
        where: { id: student.id, passwordHash: student.passwordHash },
        data: { passwordHash: newHash },
      });
      if (migrated.count !== 1) {
        return NextResponse.json({ error: SIGN_IN_FAILED_MESSAGE }, { status: 401 });
      }
    } catch (err) {
      logger.warn("Password rehash failed", { student: studentLogKey(student.id), error: errorForLog(err) });
    }
  }

  // The password was right, and both answers below say so. Give the network
  // unit back here and nowhere earlier: every refusal above answers the same
  // 401 whatever the password was, so a unit that came back for a locked or
  // closed account would let the caller read "right password" off the
  // network count, past the per-account lock. A degraded limiter took no
  // unit, so there is nothing to give back.
  if (!networkRl.degraded) {
    await refundRateLimit(networkKey, networkRl.resetTime);
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
      // True while the account still holds a password somebody else chose —
      // today, one issued by SPOKES intake. A prompt for the client, not a
      // gate: the session above is already set, and nothing server-side
      // refuses a request while this is true. Server-side enforcement needs a
      // self-service change-password surface, which does not exist yet.
      mustChangePassword: student.mustChangePassword,
    },
  });
});
