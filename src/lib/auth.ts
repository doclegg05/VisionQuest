import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { prismaAdmin } from "./db";
import { cached, invalidatePrefix, primeCache } from "./cache";
import { isCohortDemoEnabled, type DemoAccountKind } from "./demo/config";
import { runHashJob } from "./hash-queue";
import { errorForLog } from "./log-error";
import { logger } from "./logger";
import { passwordChangeRequired } from "./password-change-gate";
import { isSessionTokenRevoked, revokeSessionToken } from "./session-revocation";
import {
  signToken as signSessionToken,
  verifyToken as verifySessionToken,
  signMfaSessionToken as signMfa,
  verifyMfaSessionToken as verifyMfa,
  type SessionClaims,
  type MfaSessionClaims,
} from "./session-token";

const MFA_COOKIE_MAX_AGE_S = 5 * 60;
const COOKIE_NAME = "vq-session";
const MFA_COOKIE_NAME = "vq-mfa-challenge";

export type { SessionClaims, MfaSessionClaims };

// --- Password hashing ---
//
// Two formats are supported simultaneously:
//   Legacy PBKDF2:  "<salt>:<hash>"
//   Current scrypt: "scrypt$<salt>$<hash>"
//
// New hashes always use scrypt. On a successful login against a legacy
// PBKDF2 hash, the login route rehashes transparently to migrate the
// user to scrypt without prompting them. Over time the PBKDF2 population
// decays to zero.
//
// Both run on Node's thread pool, never on the event loop: one sign-in used
// to stop every other request for the tens of milliseconds its hash took, and
// a classroom signing in together stalled the site for seconds. They also go
// through the hash queue (src/lib/hash-queue.ts), a few at a time, so that
// classroom does not start 30 hashes of about 32 MB each at once. Every
// function below that hashes therefore answers a promise.

const SCRYPT_PARAMS = {
  // N=2^15 (32768) balances ~50-80ms login latency with memory-hard
  // resistance on modest hardware (e.g. Render free tier). If p95 login
  // latency goes above ~200ms in prod, drop to 2^14 (16384) — still above
  // OWASP 2024 minimums, and existing scrypt hashes remain verifiable.
  N: 1 << 15,
  r: 8,
  p: 1,
  keylen: 64,
  // Scrypt uses ~128 * N * r bytes of memory. Node's default maxmem is 32 MiB,
  // which is right at the edge for N=2^15/r=8. Bump to 64 MiB to leave headroom.
  maxmem: 64 * 1024 * 1024,
} as const;

/** Settles a promise with the derived key as hex, from a Node crypto callback. */
function hexFromCallback(resolve: (hex: string) => void, reject: (error: Error) => void) {
  return (error: Error | null, derived: Buffer): void => {
    if (error) reject(error);
    else resolve(derived.toString("hex"));
  };
}

// `crypto.scrypt` and `crypto.pbkdf2` are read when called, not captured when
// this module loads, so a test can count the calls.
function scryptHash(password: string, salt: string): Promise<string> {
  return runHashJob(
    () =>
      new Promise<string>((resolve, reject) => {
        const options = {
          N: SCRYPT_PARAMS.N,
          r: SCRYPT_PARAMS.r,
          p: SCRYPT_PARAMS.p,
          maxmem: SCRYPT_PARAMS.maxmem,
        };
        crypto.scrypt(password, salt, SCRYPT_PARAMS.keylen, options, hexFromCallback(resolve, reject));
      }),
  );
}

/** The legacy KDF, kept only to check hashes made before scrypt. */
function legacyPbkdf2Hash(password: string, salt: string): Promise<string> {
  return runHashJob(
    () =>
      new Promise<string>((resolve, reject) => {
        crypto.pbkdf2(password, salt, 100000, 64, "sha512", hexFromCallback(resolve, reject));
      }),
  );
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(32).toString("hex");
  const derived = await scryptHash(password, salt);
  return { hash: `scrypt$${salt}$${derived}`, salt };
}

export interface PasswordVerifyResult {
  valid: boolean;
  needsRehash: boolean;
}

export async function verifyPasswordWithStatus(password: string, stored: string): Promise<PasswordVerifyResult> {
  // Current format: scrypt$<salt>$<hash>
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, salt, hash] = parts;
    if (!salt || !hash) return { valid: false, needsRehash: false };
    try {
      const candidate = await scryptHash(password, salt);
      const expected = Buffer.from(hash, "hex");
      const actual = Buffer.from(candidate, "hex");
      if (expected.length !== actual.length) return { valid: false, needsRehash: false };
      const valid = crypto.timingSafeEqual(expected, actual);
      return { valid, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Legacy format: <salt>:<hash> (PBKDF2)
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return { valid: false, needsRehash: false };
  try {
    const candidate = await legacyPbkdf2Hash(password, salt);
    const expected = Buffer.from(hash, "hex");
    const actual = Buffer.from(candidate, "hex");
    if (expected.length !== actual.length) return { valid: false, needsRehash: false };
    const valid = crypto.timingSafeEqual(expected, actual);
    // If the legacy hash matched, signal that the caller should rehash with scrypt.
    return { valid, needsRehash: valid };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

/**
 * Boolean-only wrapper for callers that don't care about rehashing
 * (e.g. security-question answer verification).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return (await verifyPasswordWithStatus(password, stored)).valid;
}

// Precomputed dummy hash used to equalize timing when the account doesn't exist.
// Uses the current (scrypt) format so its CPU cost matches the fast path.
// Started when this module loads, as before, so it is ready long before the
// first sign-in. A check that needs it waits for it.
const DUMMY_HASH: Promise<string> = (async () => {
  const salt = crypto.randomBytes(32).toString("hex");
  const derived = await scryptHash("dummy-password-never-matches", salt);
  return `scrypt$${salt}$${derived}`;
})();

function isKnownHashFormat(stored: string): boolean {
  return stored.startsWith("scrypt$") || stored.includes(":");
}

/**
 * Verify a password, always running the KDF even when `stored` is null/empty.
 * Prevents timing-based account enumeration by ensuring the request spends
 * roughly the same CPU time whether or not the account exists.
 */
export async function verifyPasswordSafeWithStatus(
  password: string,
  stored: string | null | undefined,
): Promise<PasswordVerifyResult> {
  const hasStoredHash = Boolean(stored && isKnownHashFormat(stored));
  const target = hasStoredHash ? stored! : await DUMMY_HASH;
  const result = await verifyPasswordWithStatus(password, target);
  // Dummy work equalizes timing; it must never authenticate a malformed hash.
  return hasStoredHash ? result : { valid: false, needsRehash: false };
}

/** Boolean-only wrapper preserved for existing callers. */
export async function verifyPasswordSafe(password: string, stored: string | null | undefined): Promise<boolean> {
  return (await verifyPasswordSafeWithStatus(password, stored)).valid;
}

// --- JWT (re-exported from ./session-token so middleware can import the
// verifier without pulling Prisma via this module) ---

export const signToken = signSessionToken;
export const verifyToken = verifySessionToken;

// --- Session helpers ---

/** What every place that issues a session must say about it. */
export interface SessionCookieOptions {
  /**
   * Whether this session is held to the change-password screen. Required, so
   * the compiler finds every place that signs someone in. Pass
   * `passwordChangeRequired(row)` for an account read from the database, and
   * `false` only where the caller has just set the password itself or made an
   * account that nobody else could have set one for.
   */
  mustChangePassword: boolean;
  demo?: DemoAccountKind;
}

export async function setSessionCookie(
  studentId: string,
  role: string,
  sessionVersion: number,
  options: SessionCookieOptions,
) {
  const token = signToken(studentId, role, sessionVersion, options);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return token;
}

/** The columns a session lookup reads. The last two only decide `mustChangePassword`. */
const SESSION_ACCOUNT_SELECT = {
  id: true,
  studentId: true,
  displayName: true,
  role: true,
  sessionVersion: true,
  isActive: true,
  demoAccount: true,
  mustChangePassword: true,
  passwordHash: true,
} as const;

type SessionAccountRow = Prisma.StudentGetPayload<{ select: typeof SESSION_ACCOUNT_SELECT }>;

/**
 * The account behind a session, as the session cache holds it. The password
 * hash is read only to answer "must this account change its password" and is
 * dropped here: the answer is cached, the hash never is.
 */
function sessionAccountFrom(row: SessionAccountRow) {
  return {
    id: row.id,
    studentId: row.studentId,
    displayName: row.displayName,
    role: row.role,
    sessionVersion: row.sessionVersion,
    isActive: row.isActive,
    demoAccount: row.demoAccount,
    mustChangePassword: passwordChangeRequired(row),
  };
}

type SessionAccount = ReturnType<typeof sessionAccountFrom>;

/**
 * How long getSession() reuses an account row it has read: 60 seconds.
 *
 * ONE INSTANCE, ONE PROCESS. The row is kept in this process's memory
 * (src/lib/cache.ts). Keeping it this long is safe only because every write
 * that changes what a session depends on runs in this same process and drops
 * the row as soon as it has committed, with `invalidateSessionCache`: a
 * password reset or change, a deactivation, an offboarding, a role change.
 * Sign-out does not touch the row. It revokes the one token, and that answer
 * has its own cache of 10 seconds per token, dropped the same way
 * (src/lib/session-revocation.ts). So a session that should have ended is
 * refused on the next request, not up to 60 seconds later.
 *
 * A write this process cannot see waits out the window: a script or a SQL
 * console that changes an account is honored after at most 60 seconds, or at
 * once after a restart. The same holds for the moment in a deploy when the
 * old and the new copy of the app may both be running: each has its own
 * memory, and the copy that did not make a write keeps its row until the
 * window ends or it shuts down.
 *
 * A SECOND INSTANCE would break this. Its writes would not reach this
 * process's memory, so a reset or deactivated session would keep working here
 * for up to 60 seconds. Before adding one, do one of three things: move the
 * session row and its invalidation to a store both instances share (the
 * adapter in src/lib/cache.ts is the seam, and the revocation cache needs the
 * same), or send every invalidation to every instance, or bring this back
 * down to a few seconds and accept the extra reads.
 */
export const SESSION_CACHE_TTL_S = 60;

function sessionCacheKey(id: string, sessionVersion: number): string {
  return `session:${id}:${sessionVersion}`;
}

async function readSessionAccount(id: string): Promise<SessionAccount | null> {
  const row = await prismaAdmin.student.findUnique({ where: { id }, select: SESSION_ACCOUNT_SELECT });
  return row ? sessionAccountFrom(row) : null;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const claims = verifyToken(token);
  if (!claims) return null;

  // Neither lookup needs the other's answer, so both are issued before either
  // is awaited: a cold request waits for one round trip, not two. Logout
  // revokes the presented token server-side. A failure of either lookup
  // throws: no session on an unknown answer.
  const [revoked, student] = await Promise.all([
    isSessionTokenRevoked(token),
    cached(sessionCacheKey(claims.sub, claims.sv), SESSION_CACHE_TTL_S, () => readSessionAccount(claims.sub)),
  ]);
  if (revoked) return null;
  return sessionFrom(claims, student);
}

/**
 * The session a verified token and its account row make together, or null
 * when the row does not bear the token out. Every check here runs on each
 * request, on a cached row as on a fresh one.
 */
function sessionFrom(claims: SessionClaims, student: SessionAccount | null) {
  if (!student || student.sessionVersion !== claims.sv || !student.isActive) return null;
  // The switch is read here, after the cache, and not inside the cached
  // lookup: turning demo mode off must end demo sessions at once, not when a
  // cached row expires.
  if (student.demoAccount && !isCohortDemoEnabled()) return null;
  // The proxy fences on the token's demo claim and handlers read the row, so
  // the two must agree in both directions. A real account has neither.
  if ((claims.demo ?? null) !== (student.demoAccount ?? null)) return null;
  // The same rule for the forced password change: the proxy holds a session
  // by its token's claim, so a token and a row that disagree are no session.
  // This is what ends a token signed before the claim existed for an account
  // that must change its password, and a token that still says "must change"
  // after the account no longer does. Signing in again issues one that agrees.
  if ((claims.mustChangePassword === true) !== student.mustChangePassword) return null;
  return {
    id: student.id,
    studentId: student.studentId,
    displayName: student.displayName,
    role: student.role,
    // Real accounts get no demoAccount key at all.
    ...(student.demoAccount ? { demoAccount: student.demoAccount } : {}),
    // Set only while the session is held to the change-password screen.
    ...(student.mustChangePassword ? { mustChangePassword: true as const } : {}),
  };
}

/** Counts invalidations, so `sessionCachePrimer` can tell whether one landed after a row was read. */
let sessionCacheInvalidations = 0;

/**
 * Drop an account's cached session row. Call it straight after ANY write that
 * changes a column the session reads (SESSION_ACCOUNT_SELECT): the session
 * version, the role, `isActive`, the password or its must-change flag, the
 * login or the name. Call it once the write has committed, never inside its
 * transaction: a request that read the row between an early call and the
 * commit would put the old row back for the whole window.
 */
export function invalidateSessionCache(studentId: string) {
  sessionCacheInvalidations += 1;
  invalidatePrefix(`session:${studentId}`);
}

/**
 * For sign-in: keep the account row it has just checked, so the first request
 * after signing in does not read the account again.
 *
 * Take the primer BEFORE reading the row, and call it once the session is
 * issued. If any session row was invalidated in between, the row in hand may
 * be older than that write (a reset or a deactivation that landed while the
 * password was being checked), so nothing is stored and the next request reads
 * the account as usual. The count is for all accounts, not this one: an
 * invalidation is rare, and a skipped prime costs one read.
 */
export function sessionCachePrimer(): (row: SessionAccountRow) => void {
  const invalidationsAtRead = sessionCacheInvalidations;
  return (row) => {
    if (invalidationsAtRead !== sessionCacheInvalidations) return;
    primeCache(sessionCacheKey(row.id, row.sessionVersion), SESSION_CACHE_TTL_S, sessionAccountFrom(row));
  };
}

/** Our tokens always carry `exp`; the fallback is the 7-day TOKEN_TTL. */
function revocationExpiry(claims: SessionClaims): Date {
  return claims.exp !== undefined
    ? new Date(claims.exp * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const claims = token ? verifyToken(token) : null;
  if (token && claims) {
    try {
      await revokeSessionToken(token, revocationExpiry(claims));
    } catch (error) {
      // Logout still signs the browser out and answers as it always has. The
      // token stays valid until it expires, as it did before revocation.
      logger.error("session_revocation_failed", { error: errorForLog(error) });
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

// --- MFA challenge cookie helpers ---
//
// The MFA session token is stored in a short-lived httpOnly cookie instead
// of returned in the login JSON body. This prevents pre-session XSS on the
// login page from exfiltrating it. Cookie is path-scoped to /api/auth/mfa
// so it only travels to the challenge route.

export async function setMfaSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MFA_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: MFA_COOKIE_MAX_AGE_S, // matches MFA_TOKEN_TTL JWT expiry
    path: "/api/auth/mfa",
  });
}

export async function getMfaSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(MFA_COOKIE_NAME)?.value ?? null;
}

export async function clearMfaSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MFA_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/api/auth/mfa",
  });
}

// --- Normalize student ID ---

export function normalizeStudentId(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// --- MFA session tokens ---

export const signMfaSessionToken = signMfa;
export const verifyMfaSessionToken = verifyMfa;
