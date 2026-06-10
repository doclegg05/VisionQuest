/**
 * Confirm-before-execute tokens for Sage write tools (Phase 3).
 *
 * When a write tool is invoked without confirmation, it returns a proposal
 * card carrying an HMAC-signed token over (tool, args, session, conversation,
 * expiry). The confirm button replays the exact same call to
 * /api/chat/tool-confirm with the token — the server re-verifies the HMAC, so
 * neither the model nor the client can alter the action between proposal and
 * confirmation, and a token cannot be forged for a different user or args.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface ConfirmationPayload {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  conversationId: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
}

/** Canonical JSON: sorted keys so semantically-equal args hash identically. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function signatureFor(payload: ConfirmationPayload, expiresAt: number): string {
  return createHmac("sha256", getSecret())
    .update(
      [
        payload.toolName,
        canonicalize(payload.args),
        payload.sessionId,
        payload.conversationId,
        String(expiresAt),
      ].join("|"),
    )
    .digest("hex");
}

/** Token format: `<expiresAtMs>.<hmac>`. Clock injected for testability. */
export function createConfirmationToken(payload: ConfirmationPayload, clock: Date): string {
  const expiresAt = clock.getTime() + TOKEN_TTL_MS;
  return `${expiresAt}.${signatureFor(payload, expiresAt)}`;
}

export function verifyConfirmationToken(
  token: string,
  payload: ConfirmationPayload,
  clock: Date,
): boolean {
  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiresAt = Number.parseInt(token.slice(0, separator), 10);
  if (!Number.isFinite(expiresAt) || clock.getTime() > expiresAt) return false;

  const provided = token.slice(separator + 1);
  const expected = signatureFor(payload, expiresAt);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}
