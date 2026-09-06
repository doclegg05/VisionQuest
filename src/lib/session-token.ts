import jwt from "jsonwebtoken";

const TOKEN_TTL = "7d";
const MFA_TOKEN_TTL = "5m";

export interface SessionClaims {
  sub: string;
  role: string;
  sv: number;
}

export interface MfaSessionClaims {
  sub: string;
  role: string;
  sv: number;
  purpose: "mfa_challenge";
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return secret;
}

export function signToken(studentId: string, role: string, sessionVersion: number): string {
  return jwt.sign({ sub: studentId, role, sv: sessionVersion }, getJwtSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: "HS256",
  });
}

/**
 * Verify a full-session token (the `vq-session` cookie).
 *
 * Session tokens and MFA-challenge tokens are deliberately NOT
 * interchangeable. Both are HS256 over the same JWT_SECRET and carry the same
 * sub/role/sv claims, so a signature check alone cannot tell them apart — the
 * `purpose` claim is the only separator, and it must be enforced HERE as well
 * as in `verifyMfaSessionToken`.
 *
 * Why it matters: /api/auth/login mints an MFA challenge token the moment the
 * PASSWORD verifies, before any TOTP code is presented, and returns it in a
 * Set-Cookie header. A non-browser client can read that header and replay the
 * token as `vq-session`. While this verifier ignored `purpose`, that replay
 * produced a full teacher/admin session with the second factor never
 * presented. The same shape applies to the emailed password-reset flow and the
 * Google OAuth callback, both of which also hand out challenge tokens.
 *
 * The check is "carries a purpose claim at all", not "carries mfa_challenge",
 * so any future purpose-scoped token is rejected by default rather than
 * inheriting session authority the day it is added. Session tokens themselves
 * are never given a purpose claim, so existing 7-day tokens keep working.
 */
export function verifyToken(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as Partial<SessionClaims>;
    // Fail closed on any purpose-scoped token before looking at anything else.
    if ("purpose" in (payload as Record<string, unknown>)) {
      return null;
    }
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

export function signMfaSessionToken(studentId: string, role: string, sessionVersion: number): string {
  return jwt.sign(
    { sub: studentId, role, sv: sessionVersion, purpose: "mfa_challenge" },
    getJwtSecret(),
    { expiresIn: MFA_TOKEN_TTL, algorithm: "HS256" },
  );
}

/**
 * Verify a short-lived MFA challenge token (the `vq-mfa-challenge` cookie).
 *
 * The counterpart to `verifyToken`, and non-interchangeable with it by design:
 * this verifier requires `purpose === "mfa_challenge"`, so a full session
 * token can never be presented as a completed-password-step challenge, just as
 * a challenge token can never be presented as a session.
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
