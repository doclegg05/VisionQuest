// =============================================================================
// "Is prismaAdmin actually privileged?" — the F63 boot probe for this feature.
//
// `prismaAdmin` falls back to `DATABASE_URL` when `ADMIN_DATABASE_URL` is
// unset (src/lib/db.ts), which means it silently becomes the ordinary `vq_app`
// client. Every cross-student read in the nudge sweep and every write in the
// inbound webhook then returns zero rows or is refused by RLS — and both paths
// are written to be resilient, so the whole feature would go quiet with no
// error anywhere. That is the exact failure mode the 2026-09-01 review's F63
// names, and a feature that texts people is the worst place for it: the
// symptom is "nobody got a text", which looks identical to "nothing was due".
//
// The probe asks Postgres directly rather than reading the env var, because
// the question is not "is the variable set" but "does the connection this
// client actually holds bypass RLS". A misconfigured ADMIN_DATABASE_URL that
// points at vq_app answers the second question correctly and the first one
// wrongly.
// =============================================================================

import { prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Cached per process. The answer cannot change without a redeploy, and this
 * runs at the top of an hourly sweep and of every inbound webhook — a round
 * trip each time would be pure overhead. A FAILED probe is not cached, so a
 * database that was briefly unreachable is re-checked on the next call rather
 * than disabling the feature until the next deploy.
 */
let cached: boolean | null = null;

/** Test seam: clears the memo so a suite can exercise both answers. */
export function resetAdminClientProbe(): void {
  cached = null;
}

export async function adminClientIsPrivileged(): Promise<boolean> {
  if (cached !== null) return cached;

  try {
    const rows = await prismaAdmin.$queryRaw<Array<{ rolbypassrls: boolean }>>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    const privileged = rows[0]?.rolbypassrls === true;
    if (!privileged) {
      // The one alarm that says "this feature is off and nobody meant it to
      // be". Named, not phrased, so it can be alerted on.
      logger.error("nudges_admin_client_missing", {
        reason: "the admin Prisma client is not RLS-bypassing; set ADMIN_DATABASE_URL",
      });
    }
    cached = privileged;
    return privileged;
  } catch (error) {
    // An unreachable database is not the same finding, and caching it would
    // turn a blip into a silent outage.
    logger.error("nudges_admin_client_probe_failed", { error: String(error) });
    return false;
  }
}
