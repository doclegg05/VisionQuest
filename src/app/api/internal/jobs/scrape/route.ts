import { NextResponse } from "next/server";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { runAllAutoRefreshScrapes } from "@/lib/job-board/scrape-engine";

/**
 * POST /api/internal/jobs/scrape
 *
 * Cron endpoint — runs Monday auto-refresh for all configured classes.
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const totalJobs = await runAllAutoRefreshScrapes();
  const duration = Date.now() - start;

  logger.info("Cron job scrape complete", { totalJobs, durationMs: duration });

  return NextResponse.json({ totalJobs, durationMs: duration });
}
