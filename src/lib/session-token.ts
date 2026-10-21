import jwt from "jsonwebtoken";
import { DEMO_ACCOUNT_KINDS, type DemoAccountKind } from "./demo/config";

const TOKEN_TTL = "7d";
const MFA_TOKEN_TTL = "5m";

export interface SessionClaims {
  sub: string;
  role: string;
  sv: number;
  /**
   * Set only on demo accounts. src/proxy.ts reads it to fence demo sessions
   * without a database lookup. Real accounts never carry the key at all.
   */
  demo?: DemoAccountKind;
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

export function signToken(
  studentId: string,
  role: string,
  sessionVersion: number,
  options: { demo?: DemoAccountKind } = {},
): string {
  // A real account's payload stays exactly {sub, role, sv}: no `demo` key.
  const claims: SessionClaims = {
    sub: studentId,
    role,
    sv: sessionVersion,
    ...(options.demo === undefined ? {} : { demo: options.demo }),
  };
  return jwt.sign(claims, getJwtSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: "HS256",
  });
}

function isDemoAccountKind(value: unknown): value is DemoAccountKind {
  return DEMO_ACCOUNT_KINDS.some((kind) => kind === value);
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
 *
 * A `demo` claim, when present, must be one of DEMO_ACCOUNT_KINDS. Anything
 * else, a non-string included, fails the whole token: a claim this code does
 * not recognize is not one it can safely ignore. Tokens with no `demo` key
 * (every real account, and every token issued before demo mode) verify as
 * before.
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
    if ("demo" in payload && !isDemoAccountKind(payload.demo)) {
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
