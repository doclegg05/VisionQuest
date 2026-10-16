import { NextResponse } from "next/server";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { processJobs } from "@/lib/jobs";
import "@/lib/jobs-registry"; // Ensure handlers are registered
import { logger } from "@/lib/logger";

/**
 * POST /api/internal/jobs/process
 *
 * Cron endpoint that processes pending background jobs.
 * Can also be called inline after enqueuing for immediate processing.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const processed = await processJobs(20);
  const duration = Date.now() - start;

  logger.info("Job processing complete", { processed, durationMs: duration });

  return NextResponse.json({ processed, durationMs: duration });
}
