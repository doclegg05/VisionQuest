import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { runNudges } from "@/lib/nudges/schedule";

/**
 * POST /api/internal/nudges/run — the hourly `connect-nudges` cron.
 *
 * Auth is the same bearer check every sibling in src/app/api/internal uses, and
 * the same one src/proxy.ts consults to exempt the path from the Origin check.
 * The request carries no session, so every cross-student read inside the runner
 * goes through prismaAdmin and every per-student write runs inside that
 * student's RLS context (review F5/F62, 2026-09-01).
 *
 * `?dryRun=1` returns the plan and writes nothing — the safe way to see what a
 * class would receive before the flags are turned on.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  try {
    const result = await runNudges({ dryRun });
    logger.info("Nudge run complete", {
      dryRun: result.dryRun,
      alertsWritten: result.alertsWritten,
      alertsResolved: result.alertsResolved,
      textsPlanned: result.textsPlanned,
      textsSent: result.textsSent,
    });
    return NextResponse.json(result);
  } catch (error) {
    // A 500 here is what the cron-health monitor is watching for, so the
    // failure must surface rather than be swallowed into a 200.
    logger.error("Nudge run failed", { error: String(error) });
    return NextResponse.json({ error: "Nudge run failed." }, { status: 500 });
  }
}
