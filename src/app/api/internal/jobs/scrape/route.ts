import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { runAllAutoRefreshScrapes } from "@/lib/job-board/scrape-engine";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/internal/jobs/scrape
 *
 * Cron endpoint — runs Monday auto-refresh for all configured classes.
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const totalJobs = await runAllAutoRefreshScrapes();
  const duration = Date.now() - start;

  logger.info("Cron job scrape complete", { totalJobs, durationMs: duration });

  return NextResponse.json({ totalJobs, durationMs: duration });
}
