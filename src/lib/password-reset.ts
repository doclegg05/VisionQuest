import crypto from "crypto";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function hashPasswordResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generatePasswordResetToken() {
  const token = crypto.randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  };
}
