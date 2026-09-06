// =============================================================================
// Employer link tokens — the pure half.
//
// The token is 32 random bytes, base64url. Only its sha256 is ever stored, and
// the token itself is written exactly once, into the email body. It is never
// logged, never put in an audit metadata blob, and never returned by an API.
//
// sha256 rather than the HMAC the password-reset path uses: that token
// authenticates a person who already has an account, so binding it to the
// server secret protects against a leaked table being replayed. This token
// authenticates nobody — it is a capability URL for a stranger, already
// unguessable at 256 bits, and a plain digest keeps the lookup a single
// indexed equality with no key-rotation failure mode on a link that lives in
// somebody's inbox for two weeks.
//
// This module must never import @/lib/db.
// =============================================================================

import crypto from "crypto";

/** 14 days (design spec §6 step 3). */
export const EMPLOYER_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** One `employer_viewed` event per token per hour, so a refresh is not a story. */
export const EMPLOYER_VIEW_EVENT_INTERVAL_MS = 60 * 60 * 1000;

export function hashEmployerToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface MintedEmployerToken {
  /** Shown once, in the email. Never stored, never logged. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function mintEmployerToken(now: Date = new Date()): MintedEmployerToken {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashEmployerToken(token),
    expiresAt: new Date(now.getTime() + EMPLOYER_TOKEN_TTL_MS),
  };
}

/**
 * A token from a URL segment, or null.
 *
 * Bounded and character-checked before it reaches a query: base64url of 32
 * bytes is 43 characters, and anything else is not a token this program
 * minted. Rejecting it here means the neutral page is rendered without a
 * database round trip.
 */
export function normalizeEmployerToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length < 20 || value.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

/** What every dead link says. One message for expired, used, unknown and off. */
export const EMPLOYER_LINK_INACTIVE_MESSAGE = "This link is no longer active.";
