// =============================================================================
// Sage Agent — Confirm-Token Single-Use Claims
//
// A verified confirm token used to authorize execution for its entire 10-min
// TTL: the HMAC binds WHAT runs, but nothing marked the token spent, so the
// same card could execute repeatedly (harmless for upsert-shaped tools,
// duplicating for add-shaped ones). This module closes that window: before
// executing, /api/chat/tool-confirm claims the token here, and a token can be
// claimed exactly once.
//
// Semantics, pinned by tests:
// - The claim is one atomic INSERT keyed on the token's sha256 — concurrent
//   confirms race on the primary key and exactly one wins (P2002 = replay).
// - A claim is burned by the ATTEMPT, not the outcome. Releasing it when the
//   tool errors would re-open replay precisely when a partial write may have
//   happened; a failed confirm means asking Sage for a fresh card.
// - Store failure fails CLOSED (throws; nothing executes) — the opposite of
//   the login rate limiter's fail-open, because here the downside of being
//   unavailable is a retry, while the downside of being open is a duplicate
//   consequential write. This is also why the claim does NOT reuse the
//   RateLimitEntry store or its failure policy.
//
// Deliberately prismaAdmin: the table is server-internal bookkeeping like
// RateLimitEntry (admin-only RLS; no student-scoped rows), and it is not a
// watched model, so bypassing the write-through cache extension is safe —
// see the prismaAdmin doc block in src/lib/db.ts.
// =============================================================================

import { createHash } from "node:crypto";
import { prismaAdmin as prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { confirmationTokenExpiry, TOKEN_TTL_MS } from "./confirmation";

export type ConfirmationClaim = "claimed" | "replayed";

/** Prisma P2002 = unique-constraint violation: another confirm of the same
 *  token already claimed it. Duck-typed like wagers.ts / progression/events.ts. */
function isAlreadyClaimed(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

/**
 * Claim a verified confirmation token for execution. "claimed" means this
 * caller holds the one execution the token authorizes; "replayed" means the
 * token was already spent. Store failure throws — callers must not execute.
 *
 * Rows only need to outlive their token: past expiresAt the HMAC check
 * rejects the token before any claim is attempted, so each successful claim
 * opportunistically sweeps expired rows (best-effort, never blocks).
 */
export async function claimConfirmationToken(
  token: string,
  clock: Date,
): Promise<ConfirmationClaim> {
  // Only the hash is stored: fixed-length, and a leaked row can't be turned
  // back into a working token.
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt =
    confirmationTokenExpiry(token) ?? new Date(clock.getTime() + TOKEN_TTL_MS);

  try {
    await prisma.sageConfirmationUse.create({ data: { tokenHash, expiresAt } });
  } catch (err) {
    if (isAlreadyClaimed(err)) return "replayed";
    throw err;
  }

  void prisma.sageConfirmationUse
    .deleteMany({ where: { expiresAt: { lt: clock } } })
    .catch((err) => {
      logger.warn("confirmation-use: expired-claim sweep failed", { err: String(err) });
    });

  return "claimed";
}
