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

/** The expiry a prefix names, or null unless it is spelled EXACTLY as
 *  createConfirmationToken writes it.
 *
 *  Number.parseInt was the wrong reader here: it tolerates leading
 *  whitespace, a leading "+", leading zeros and trailing garbage, so
 *  " 1788733123662", "+1788733123662", "01788733123662" and
 *  "1788733123662x" all recovered the same expiry — and therefore the same
 *  expected HMAC — while being five DIFFERENT strings. The single-use claim
 *  in confirmation-use.ts keys on sha256 of the whole token, so each spelling
 *  bought a fresh claim and one approved card executed unlimited times.
 *  Requiring String(expiresAt) === prefix admits exactly one spelling per
 *  expiry, which is what makes the claim's key a faithful identity for the
 *  authorization the token carries. The token FORMAT is unchanged — a token
 *  createConfirmationToken produced still parses, so cards already in flight
 *  keep working for the rest of their TTL. */
function canonicalExpiry(prefix: string): number | null {
  const expiresAt = Number(prefix);
  if (!Number.isSafeInteger(expiresAt) || String(expiresAt) !== prefix) return null;
  return expiresAt;
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
  const expiresAt = canonicalExpiry(token.slice(0, separator));
  return expiresAt === null ? null : new Date(expiresAt);
}

export function verifyConfirmationToken(
  token: string,
  payload: ConfirmationPayload,
  clock: Date,
): boolean {
  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiresAt = canonicalExpiry(token.slice(0, separator));
  if (expiresAt === null || clock.getTime() > expiresAt) return false;

  // The signature half needs no separate canonicalization: `expected` is
  // fixed-length lowercase hex from digest("hex"), the length guard below
  // rejects anything longer or shorter (so trailing junk cannot ride along),
  // and timingSafeEqual then compares the bytes exactly — a non-hex character
  // in `provided` is simply a byte that does not match.
  const provided = token.slice(separator + 1);
  const expected = signatureFor(payload, expiresAt);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}
