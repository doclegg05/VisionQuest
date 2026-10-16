import { NextResponse } from "next/server";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { runAllAutoRefreshScrapes } from "@/lib/job-board/scrape-engine";

/**
 * POST /api/internal/jobs/scrape
 *
 * Cron endpoint: the weekly auto-refresh for every class with autoRefresh on,
 * Mondays at 10:05 UTC (pg_cron job `job-board-scrape`). Answers 500 when any
 * class failed, after the others ran, because the HTTP status is the only
 * part of a run that npm run cron:health can see.
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const summary = await runAllAutoRefreshScrapes();
  const durationMs = Date.now() - start;

  logger.info("Cron job scrape complete", { ...summary, durationMs });

  return NextResponse.json(
    { ...summary, durationMs },
    { status: summary.failedConfigs > 0 ? 500 : 200 },
  );
}
