import crypto from "crypto";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function getTokenHmacSecret(): string {
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("API_KEY_ENCRYPTION_KEY is required for password reset token hashing");
  }
  return secret;
}

export function hashPasswordResetToken(token: string): string {
  return crypto.createHmac("sha256", getTokenHmacSecret()).update(token).digest("hex");
}

export function generatePasswordResetToken() {
  const token = crypto.randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  };
}
