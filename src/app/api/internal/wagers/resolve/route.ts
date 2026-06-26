import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { resolveDueWagers } from "@/lib/sage/wagers";
import { enqueueJob } from "@/lib/jobs";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/internal/wagers/resolve
 *
 * Daily wager resolution (cron: sage-wager-resolve, 06:20 UTC).
 * Calls resolveDueWagers() and, when SAGE_WAGER_DIAGNOSIS_ENABLED=true,
 * enqueues a wager_diagnosis BackgroundJob for each lost wager.
 *
 * Auth: Bearer CRON_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await resolveDueWagers(new Date());

    if (process.env.SAGE_WAGER_DIAGNOSIS_ENABLED === "true") {
      for (const wagerId of result.diagnosable) {
        await enqueueJob({
          type: "wager_diagnosis",
          payload: { wagerId },
          dedupeKey: `wager_diagnosis:${wagerId}`,
        });
      }
    }

    return NextResponse.json({
      resolved: result.resolved,
      won: result.won,
      lost: result.lost,
      voided: result.voided,
      skipped: result.skipped,
    });
  } catch (error) {
    logger.error("Wager resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Wager resolution failed" }, { status: 500 });
  }
}
