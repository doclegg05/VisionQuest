import { NextResponse } from "next/server";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { errorForLog } from "@/lib/log-error";
import { runBrowseRefresh } from "@/lib/job-board/browse-scrape";

/**
 * POST /api/internal/jobs/browse-refresh
 *
 * Cron endpoint — refreshes the program-wide browse job pool from keyless sources.
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const start = Date.now();
    const result = await runBrowseRefresh();
    const durationMs = Date.now() - start;

    logger.info("Browse refresh cron complete", { ...result, durationMs });

    return NextResponse.json({ ok: true, ...result, durationMs });
  } catch (error) {
    logger.error("browse-refresh failed", {
      error: errorForLog(error),
    });
    return NextResponse.json({ error: "Browse refresh failed" }, { status: 500 });
  }
}
