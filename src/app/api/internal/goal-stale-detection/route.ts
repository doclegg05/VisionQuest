import { NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/csrf";
import { runGoalStaleDetection } from "@/lib/goal-stale-detection";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/goal-stale-detection
 *
 * Daily (pg_cron job goal-stale-detection, 10:45 UTC). Scans every
 * non-terminal goal with the level-aware rule the intervention queue uses
 * (daily 3 days, weekly 7, monthly 14, quarterly 30, BHAG 60, measured from
 * the last review, else the last update), opens a goal_stale StudentAlert for
 * each stale goal, and resolves open ones whose goals are no longer stale.
 * The alert sync builds the same alert on activity; this job covers students
 * with no activity to trigger it.
 *
 * Auth: Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  const authorized = isAuthorizedInternalRequest(
    new URL(req.url).pathname,
    req.headers.get("authorization"),
    process.env.CRON_SECRET,
  );
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const now = new Date();

  try {
    const { scanned, newAlerts } = await runGoalStaleDetection(now);

    logger.info("Stale goal detection complete", {
      scanned,
      newAlerts,
      durationMs: Date.now() - start,
    });

    return NextResponse.json({
      success: true,
      data: { scanned, newAlerts, timestamp: now.toISOString() },
    });
  } catch (error: unknown) {
    logger.error("Stale goal detection failed", { error: errorForLog(error) });
    return NextResponse.json({ error: "Stale goal detection failed" }, { status: 500 });
  }
}
