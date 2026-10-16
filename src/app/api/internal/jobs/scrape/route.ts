import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { runAllAutoRefreshScrapes } from "@/lib/job-board/scrape-engine";

const SENTRY_TAGS = { jobname: "job-board-scrape" };

/**
 * POST /api/internal/jobs/scrape
 *
 * Cron endpoint: the weekly auto-refresh for every class with autoRefresh on,
 * Mondays at 10:05 UTC (pg_cron job `job-board-scrape`).
 *
 * A class whose scrape threw or whose every source failed counts as failed:
 * the route answers 500 after the other classes ran, and reports it to
 * Sentry, because pg_cron records every run as succeeded and the nightly
 * cron:health check reads only the last six hours of HTTP statuses. A class
 * whose sources all lack an API key is counted in unconfiguredConfigs and is
 * not a failure.
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const summary = await runAllAutoRefreshScrapes();
    const durationMs = Date.now() - start;
    const data = { ...summary, durationMs };
    logger.info("Cron job scrape complete", { ...summary, durationMs });

    if (summary.failedConfigs > 0) {
      Sentry.captureMessage(`Weekly job board scrape: ${summary.failedConfigs} class(es) failed`, {
        level: "error",
        tags: SENTRY_TAGS,
        extra: data,
      });
      return NextResponse.json(
        { success: false, error: "Job board scrape finished with failures", data },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error("Job board scrape failed", { error: errorForLog(error) });
    Sentry.captureMessage("Weekly job board scrape failed before it finished", {
      level: "error",
      tags: SENTRY_TAGS,
      extra: { error: errorForLog(error) },
    });
    return NextResponse.json({ error: "Job board scrape failed" }, { status: 500 });
  }
}
