import crypto from "node:crypto";
import { normalizeEmail } from "@/lib/auth";

export const DEFAULT_INVITATION_TTL_HOURS = 72;

export function createInvitationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeInvitationEmail(email: string): string {
  return normalizeEmail(email);
}

export function invitationIsRedeemable(input: {
  email: string;
  expectedEmail: string;
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  return (
    normalizeInvitationEmail(input.email) ===
      normalizeInvitationEmail(input.expectedEmail) &&
    input.expiresAt.getTime() > now.getTime() &&
    input.redeemedAt === null &&
    input.revokedAt === null
  );
}
