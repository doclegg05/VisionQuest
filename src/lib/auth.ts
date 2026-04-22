import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { cached, invalidatePrefix } from "./cache";
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

function scryptHash(password: string, salt: string): string {
  return crypto
    .scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    })
    .toString("hex");
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(32).toString("hex");
  const derived = scryptHash(password, salt);
  return { hash: `scrypt$${salt}$${derived}`, salt };
}

export interface PasswordVerifyResult {
  valid: boolean;
  needsRehash: boolean;
}

export function verifyPasswordWithStatus(password: string, stored: string): PasswordVerifyResult {
  // Current format: scrypt$<salt>$<hash>
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, salt, hash] = parts;
    if (!salt || !hash) return { valid: false, needsRehash: false };
    try {
      const candidate = scryptHash(password, salt);
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
    const candidate = crypto
      .pbkdf2Sync(password, salt, 100000, 64, "sha512")
      .toString("hex");
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
export function verifyPassword(password: string, stored: string): boolean {
  return verifyPasswordWithStatus(password, stored).valid;
}

// Precomputed dummy hash used to equalize timing when the account doesn't exist.
// Uses the current (scrypt) format so its CPU cost matches the fast path.
const DUMMY_HASH = (() => {
  const salt = crypto.randomBytes(32).toString("hex");
  const derived = scryptHash("dummy-password-never-matches", salt);
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
export function verifyPasswordSafeWithStatus(
  password: string,
  stored: string | null | undefined,
): PasswordVerifyResult {
  const target = stored && isKnownHashFormat(stored) ? stored : DUMMY_HASH;
  const result = verifyPasswordWithStatus(password, target);
  return stored ? result : { valid: false, needsRehash: false };
}

/** Boolean-only wrapper preserved for existing callers. */
export function verifyPasswordSafe(password: string, stored: string | null | undefined): boolean {
  return verifyPasswordSafeWithStatus(password, stored).valid;
}

// --- JWT (re-exported from ./session-token so middleware can import the
// verifier without pulling Prisma via this module) ---

export const signToken = signSessionToken;
export const verifyToken = verifySessionToken;

// --- Session helpers ---

export async function setSessionCookie(studentId: string, role: string, sessionVersion: number) {
  const token = signToken(studentId, role, sessionVersion);
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

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const claims = verifyToken(token);
  if (!claims) return null;

  // Cache session lookups for 10s to reduce DB hits (keyed by user ID + session version)
  const cacheKey = `session:${claims.sub}:${claims.sv}`;
  const student = await cached(cacheKey, 10, () =>
    prisma.student.findUnique({
      where: { id: claims.sub },
      select: { id: true, studentId: true, displayName: true, role: true, sessionVersion: true, isActive: true },
    }),
  );

  if (!student || student.sessionVersion !== claims.sv || !student.isActive) return null;
  return {
    id: student.id,
    studentId: student.studentId,
    displayName: student.displayName,
    role: student.role,
  };
}

/** Invalidate cached session when a user's data changes (role change, deactivation, etc.) */
export function invalidateSessionCache(studentId: string) {
  invalidatePrefix(`session:${studentId}`);
}

export async function clearSession() {
  const cookieStore = await cookies();
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
  cookieStore.delete(MFA_COOKIE_NAME);
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
