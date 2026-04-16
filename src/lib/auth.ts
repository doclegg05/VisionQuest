import crypto from "crypto";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { cached, invalidatePrefix } from "./cache";

const TOKEN_TTL = "7d";
const MFA_TOKEN_TTL = "5m";
const COOKIE_NAME = "vq-session";

interface SessionClaims {
  sub: string;
  role: string;
  sv: number;
}

interface MfaSessionClaims {
  sub: string;
  role: string;
  sv: number;
  purpose: "mfa_challenge";
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return secret;
}

// --- Password hashing ---

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return { hash: `${salt}:${hash}`, salt };
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

// Precomputed dummy hash used to equalize timing when the account doesn't exist.
// The verify will always fail, but it burns the same CPU as a real check,
// preventing a timing oracle that would let attackers enumerate valid accounts.
const DUMMY_HASH = (() => {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = crypto
    .pbkdf2Sync("dummy-password-never-matches", salt, 100000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
})();

/**
 * Verify a password, always running the KDF even when `stored` is null/empty.
 * Prevents timing-based account enumeration by ensuring the request spends
 * roughly the same CPU time whether or not the account exists.
 */
export function verifyPasswordSafe(password: string, stored: string | null | undefined): boolean {
  const target = stored && stored.includes(":") ? stored : DUMMY_HASH;
  const result = verifyPassword(password, target);
  return stored ? result : false;
}

// --- JWT ---

export function signToken(studentId: string, role: string, sessionVersion: number): string {
  return jwt.sign({ sub: studentId, role, sv: sessionVersion }, getJwtSecret(), { expiresIn: TOKEN_TTL, algorithm: "HS256" });
}

export function verifyToken(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as Partial<SessionClaims>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.sv !== "number"
    ) {
      return null;
    }
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

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

// --- Normalize student ID ---

export function normalizeStudentId(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// --- MFA session tokens ---

/**
 * Sign a short-lived JWT (5 minutes) that proves password authentication succeeded
 * but MFA verification is still required.
 */
export function signMfaSessionToken(studentId: string, role: string, sessionVersion: number): string {
  return jwt.sign(
    { sub: studentId, role, sv: sessionVersion, purpose: "mfa_challenge" },
    getJwtSecret(),
    { expiresIn: MFA_TOKEN_TTL, algorithm: "HS256" },
  );
}

/**
 * Verify and decode a MFA session token. Returns null if expired, invalid, or
 * not a MFA-purpose token.
 */
export function verifyMfaSessionToken(token: string): MfaSessionClaims | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as Partial<MfaSessionClaims>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.sv !== "number" ||
      payload.purpose !== "mfa_challenge"
    ) {
      return null;
    }
    return payload as MfaSessionClaims;
  } catch {
    return null;
  }
}
