// =============================================================================
// Session-token revocation on logout
//
// Logout used to delete only the browser's cookie, so a copy of the token
// taken before logout kept full authority until its 7-day expiry. Logout now
// records the one presented token here and getSession refuses it. Bumping
// Student.sessionVersion would also end every other device's session, and the
// shared demo instructor account would sign out every visitor at once, so the
// revocation is per token.
//
// Rows live in the existing SageConfirmationUse table, under keys of the form
// `session-revoked:<sha256 of the token>`. Confirm-card claims are bare
// 64-character hex, so the two key spaces cannot collide. The confirm path
// only inserts rows (a duplicate is its replay signal) and its sweep deletes
// only rows past expiresAt, which is set to the token's own `exp`: a revoked
// row is never removed while its token could still verify.
//
// prismaAdmin, as in confirmation-use.ts: the table is admin-only server
// bookkeeping, and getSession already reads the Student row through it.
// =============================================================================

import { createHash } from "node:crypto";
import { prismaAdmin } from "./db";
import { cached, invalidate } from "./cache";

const KEY_PREFIX = "session-revoked:";
/** Matches the Student-row cache in getSession. */
const REVOCATION_CACHE_TTL_S = 10;

function revocationKey(token: string): string {
  return `${KEY_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}

/** Prisma P2002: the token was already revoked (a second logout). */
function isAlreadyRevoked(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

/**
 * Whether this exact token was revoked by a logout. Cached for 10 seconds per
 * token. A store failure throws, so the caller fails closed.
 */
export async function isSessionTokenRevoked(token: string): Promise<boolean> {
  const key = revocationKey(token);
  return cached(key, REVOCATION_CACHE_TTL_S, async () => {
    const row = await prismaAdmin.sageConfirmationUse.findUnique({
      where: { tokenHash: key },
      select: { tokenHash: true },
    });
    return row !== null;
  });
}

/**
 * Record this exact token as revoked until it expires, then drop this
 * process's cached answer for it. Invalidating after the write also discards
 * any lookup still in flight, so a "not revoked" read that straddles the
 * logout is never cached. A store failure throws.
 */
export async function revokeSessionToken(token: string, expiresAt: Date): Promise<void> {
  const key = revocationKey(token);
  try {
    await prismaAdmin.sageConfirmationUse.create({ data: { tokenHash: key, expiresAt } });
  } catch (err) {
    if (!isAlreadyRevoked(err)) throw err;
  }
  invalidate(key);
}
