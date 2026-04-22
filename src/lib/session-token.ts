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

export function signMfaSessionToken(studentId: string, role: string, sessionVersion: number): string {
  return jwt.sign(
    { sub: studentId, role, sv: sessionVersion, purpose: "mfa_challenge" },
    getJwtSecret(),
    { expiresIn: MFA_TOKEN_TTL, algorithm: "HS256" },
  );
}

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
