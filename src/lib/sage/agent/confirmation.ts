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

export const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface ConfirmationPayload {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  conversationId: string;
  /** Staff-assisted flows: the student the action targets. Bound into the
   *  HMAC so a token proposed for one student cannot confirm for another. */
  targetStudentId?: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
}

/** Canonical JSON, matching JSON.stringify's treatment of undefined: object
 *  entries with undefined values are omitted (so an absent optional field and
 *  an explicitly-undefined one sign the same, and neither collides with ""),
 *  and undefined array elements become null. Keys sort by codepoint, not
 *  localeCompare — the sort must not depend on process locale/ICU, or the
 *  same payload could sign differently on create and verify. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const elements = value.map((element) =>
      element === undefined ? "null" : canonicalize(element),
    );
    return `[${elements.join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The signature input is canonical JSON, never a delimiter-joined field list —
 *  JSON quoting keeps every field boundary unambiguous. The payload sits under
 *  its own key so future payload fields are covered automatically and can
 *  never be shadowed by the sibling expiry entry. */
function signatureFor(payload: ConfirmationPayload, expiresAt: number): string {
  return createHmac("sha256", getSecret())
    .update(canonicalize({ expiresAt, payload }))
    .digest("hex");
}

/** Token format: `<expiresAtMs>.<hmac>`. Clock injected for testability. */
export function createConfirmationToken(payload: ConfirmationPayload, clock: Date): string {
  const expiresAt = clock.getTime() + TOKEN_TTL_MS;
  return `${expiresAt}.${signatureFor(payload, expiresAt)}`;
}

/**
 * The expiry stamped in a token's prefix, or null when the prefix doesn't
 * parse. Purely syntactic — it proves nothing about the signature, so only
 * use it on tokens that already passed verifyConfirmationToken (the claim
 * store uses it to know when a consumed-token row stops mattering).
 */
export function confirmationTokenExpiry(token: string): Date | null {
  const separator = token.indexOf(".");
  if (separator === -1) return null;
  const expiresAt = Number.parseInt(token.slice(0, separator), 10);
  return Number.isFinite(expiresAt) ? new Date(expiresAt) : null;
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
