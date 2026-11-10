import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Student } from "@prisma/client";
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
import { rateLimit, refundRateLimit, type RateLimitResult } from "@/lib/rate-limit";
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
 *
 * An attempt holds its unit until it is answered, so failed attempts plus
 * attempts in flight can never pass 30. More than 30 sign-ins from one
 * address inside the same fraction of a second would see the extra ones
 * refused once; trying again works.
 */
const NETWORK_FAILED_SIGN_IN_LIMIT = 30;

/**
 * FAILED sign-ins on one account per window, from any address. This is the
 * brute-force control. A right password gives its unit back, so a student can
 * sign in on every lab PC in turn. One unit comes back, never the wrong tries
 * before it, and a refused attempt keeps its unit whatever the password was.
 * An attempt holds its unit until it is answered, so wrong tries plus
 * attempts in flight can never pass 5.
 */
const ACCOUNT_FAILED_SIGN_IN_LIMIT = 5;

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

/** Built fresh per request so no caller can change the shared answer. */
function signInFailed(): NextResponse {
  return NextResponse.json({ error: SIGN_IN_FAILED_MESSAGE }, { status: 401 });
}

/** One unit a limiter call took, kept so a right password can give it back. */
interface TakenUnit {
  key: string;
  resetTime: number;
}

/** Null when the limiter failed open: a degraded limiter took no unit, so there is nothing to give back. */
function takenUnit(key: string, result: RateLimitResult): TakenUnit | null {
  return result.degraded ? null : { key, resetTime: result.resetTime };
}

/**
 * Gives back the units a right password took, each in the window it was taken
 * from. Call this only once the response is certain to say the password was
 * right. Every refusal answers the same 401 whatever the password was, so a
 * unit that came back for a locked, closed or Google-only account would let
 * the caller read "right password" off a count, past the per-account lock.
 */
async function giveBack(units: readonly (TakenUnit | null)[]): Promise<void> {
  await Promise.all(units.map((unit) => (unit ? refundRateLimit(unit.key, unit.resetTime) : undefined)));
}

/** The account a typed login names, and the login in the form both limiters key on. */
async function findAccount(login: string): Promise<{ student: Student | null; normalizedLogin: string }> {
  const isEmail = login.includes("@");
  const normalizedLogin = isEmail ? normalizeEmail(login) : normalizeStudentId(login);
  const student = isEmail
    ? await prisma.student.findUnique({ where: { email: normalizedLogin } })
    : await prisma.student.findUnique({ where: { studentId: normalizedLogin } });
  return { student, normalizedLogin };
}

interface AccountAttempt {
  /** True only for a real account past its limit. */
  locked: boolean;
  /** The per-account unit this attempt took, or null when the limiter failed open. */
  unit: TakenUnit | null;
}

/**
 * Per-user rate limit — prevents distributed brute force against a single
 * account. Counts this attempt and answers whether the account is locked.
 *
 * The refusal is deliberately NOT a 429: this route is reachable without a
 * session, the login is not a secret, and the per-IP bucket is larger than
 * this one — so a distinct status on the sixth attempt told an anonymous
 * caller whether the account exists, for six cheap requests per address
 * (2026-09-06 hunt, follow-up 1). A locked account now answers exactly like a
 * wrong password and exactly like an unknown login, the attempt is still
 * counted here, and the limit itself is unchanged. Precedent and identical
 * reasoning: reset-password/questions/route.ts.
 *
 * The limiter round trip runs for unknown logins too (2026-10-22 scan, F12):
 * it ran only for real accounts, so they answered one database round trip
 * slower, which the dummy KDF could not hide. A real account stays keyed on
 * its id, so its email and student-ID aliases share one budget. The
 * unknown-login key is computed on every request so both paths do the same
 * work and fail alike. An unknown login can never sign in, so its spent
 * bucket changes nothing it is told; only a real account counts as locked.
 *
 * The unit this attempt took is answered too, so a right password can give
 * it back (see `giveBack`). An unknown login never reaches that point.
 */
async function countAccountAttempt(student: Student | null, normalizedLogin: string): Promise<AccountAttempt> {
  const unknownLoginKey = unknownLoginLimiterKey(normalizedLogin);
  const accountKey = student ? `login:user:${student.id}` : unknownLoginKey;
  const userRl = await rateLimit(accountKey, ACCOUNT_FAILED_SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS);
  return { locked: student !== null && !userRl.success, unit: takenUnit(accountKey, userRl) };
}

interface FailedSignIn {
  login: string;
  ip: string;
  student: Student | null;
  accountLocked: boolean;
  isOAuthOnly: boolean;
}

/**
 * The response says nothing the caller could not already guess; the audit
 * log, which only staff read, keeps the three cases apart.
 */
async function auditFailedSignIn({ login, ip, student, accountLocked, isOAuthOnly }: FailedSignIn): Promise<void> {
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
}

/**
 * Silent migration: the stored hash used the legacy PBKDF2 format, so rehash
 * with the current scrypt format. Answers false only when a concurrent reset
 * or change won the write: never restore the old password over it. A failure
 * here must not block login — the user is already authenticated with the
 * legacy hash — so it is logged and answers true.
 */
async function upgradeLegacyHash(student: Student, password: string): Promise<boolean> {
  try {
    const { hash: newHash } = hashPassword(password);
    const migrated = await prisma.student.updateMany({
      where: { id: student.id, passwordHash: student.passwordHash },
      data: { passwordHash: newHash },
    });
    return migrated.count === 1;
  } catch (err) {
    logger.warn("Password rehash failed", { student: studentLogKey(student.id), error: errorForLog(err) });
    return true;
  }
}

/**
 * MFA is enabled: set the short-lived MFA challenge cookie and return a
 * partial response. The cookie is httpOnly + scoped to /api/auth/mfa, so it
 * cannot be stolen via pre-session XSS and only travels to challenge routes.
 */
async function startMfaChallenge(student: Student, ip: string): Promise<NextResponse> {
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

async function startSession(student: Student, ip: string): Promise<NextResponse> {
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
  const { student, normalizedLogin } = await findAccount(login);
  const { locked: accountLocked, unit: accountUnit } = await countAccountAttempt(student, normalizedLogin);

  // Consolidate all failure cases into a single generic response to prevent account enumeration.
  // Do not distinguish between: no account found, OAuth-only account, wrong password, or inactive account.
  const isOAuthOnly = student !== null && !student.passwordHash && student.authProvider === "google";
  // Always run the KDF to equalize timing and avoid an account-enumeration oracle.
  const { valid: passwordMatches, needsRehash } = verifyPasswordSafeWithStatus(
    password,
    student?.passwordHash ?? null,
  );
  const isInvalidCredentials =
    !student || !student.passwordHash || !passwordMatches || !student.isActive;

  if (accountLocked || isOAuthOnly || isInvalidCredentials) {
    await auditFailedSignIn({ login, ip, student, accountLocked, isOAuthOnly });
    return signInFailed();
  }

  if (needsRehash && !(await upgradeLegacyHash(student, password))) {
    return signInFailed();
  }

  // The password was right, and both answers below say so. Give the network
  // and the account unit back here and nowhere earlier: every refusal above
  // answers the same 401 whatever the password was (see `giveBack`).
  await giveBack([takenUnit(networkKey, networkRl), accountUnit]);

  return student.mfaEnabled ? startMfaChallenge(student, ip) : startSession(student, ip);
});
