import { NextResponse } from "next/server";
import { processJobs } from "@/lib/jobs";
import "@/lib/jobs-registry"; // Ensure handlers are registered
import { logger } from "@/lib/logger";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/internal/jobs/process
 *
 * Cron endpoint that processes pending background jobs.
 * Can also be called inline after enqueuing for immediate processing.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const processed = await processJobs(20);
  const duration = Date.now() - start;

  logger.info("Job processing complete", { processed, durationMs: duration });

  return NextResponse.json({ processed, durationMs: duration });
}
