// =============================================================================
// How a caller's rate-limit key becomes a `RateLimitEntry` row key.
//
// --- The bug this closes (2026-09-06) ---
// `RateLimitEntry.key` is the table's PRIMARY KEY, and until now it held the
// caller's key verbatim. Every per-IP limiter builds that key out of
// `X-Forwarded-For`, so the caller chose the size and the content of a btree
// index entry, with two consequences:
//
//   1. Postgres refuses a btree index row over 2704 bytes with SQLSTATE 54000.
//      That code is not retryable, so `rateLimit()` took its documented
//      fail-OPEN path and ADMITTED the request. One long header switched every
//      per-IP limiter off — including the only limiter on the staff
//      registration endpoint, where a correct ADMIN_KEY creates an admin.
//   2. Short distinct headers each inserted a permanent row. The table has no
//      TTL and, before this change, no purge anywhere in the repo.
//
// --- The shape, and why this one ---
// The stored key is `<family>:<32 hex chars of sha256(whole caller key)>`.
//
// The family — the caller key's first segment — is kept in front, readable,
// because two existing things depend on reading it: the fail-open log reports
// `keyFamily`, and scripts/seed-e2e-users.ts clears login buckets with
// `deleteMany({ where: { key: { startsWith: "login:" } } })`. Hashing the
// whole key would have made both of those into rewrites; this way the seed
// needs no change at all, and an operator can still see which subsystem a row
// belongs to without being able to recover whose it is.
//
// The digest covers the WHOLE caller key, family included, so two keys can
// never collide just because one of their families was normalized away. 32 hex
// characters is 128 bits — a collision needs ~2^64 distinct keys, which is far
// beyond anything a limiter table will ever hold — and it keeps the row key
// short enough that no index entry can approach the btree limit again.
//
// The plaintext key does not reach the database. `login:<ip>` and
// `sage-memory-extract:<studentId>` each identify a person, and the limiter
// table is not an audit log (.claude/rules/security.md).
// =============================================================================

import { createHash } from "node:crypto";

/**
 * Ceiling on a stored row key. Not a Postgres limit — the btree limit is
 * 2704 bytes and this is two orders of magnitude under it. It exists so a
 * regression is caught by a test rather than by an index.
 */
export const MAX_STORED_KEY_CHARS = 80;

/** Hex characters of the digest kept. 32 = 128 bits. */
const DIGEST_CHARS = 32;

/**
 * Longest family kept verbatim. Every family in the codebase is a short
 * literal ("login", "forgot-password", "csp-report"); the cap is here because
 * a family is still derived from a caller-supplied string and must not be a
 * second way to size the row.
 */
const MAX_FAMILY_CHARS = 32;

/**
 * A family is readable and appears in logs, so it is restricted to characters
 * that are safe to read back: no separators, no whitespace, nothing that
 * could be mistaken for structure.
 */
const FAMILY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Used when the caller key has no usable family segment. */
const FALLBACK_FAMILY = "rl";

/**
 * The caller key's family: the part before the first ":", when that part is
 * short and plainly a literal. Anything else answers `"rl"` rather than
 * echoing caller-controlled text into a log line or a row key.
 */
export function rateLimitKeyFamily(key: string): string {
  const separator = key.indexOf(":");
  const candidate = separator === -1 ? key : key.slice(0, separator);
  if (candidate.length === 0 || candidate.length > MAX_FAMILY_CHARS) return FALLBACK_FAMILY;
  if (!FAMILY_SHAPE.test(candidate)) return FALLBACK_FAMILY;
  return candidate;
}

/**
 * The row key for a caller key. Deterministic, bounded, and never the
 * plaintext. Transparent to callers: `rateLimit`, `refundRateLimit` and any
 * future reader apply it, so call sites keep passing readable keys.
 */
export function rateLimitStorageKey(key: string): string {
  const digest = createHash("sha256").update(key, "utf8").digest("hex").slice(0, DIGEST_CHARS);
  return `${rateLimitKeyFamily(key)}:${digest}`;
}
