import { NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/csrf";
import { runEvidenceGapDetection } from "@/lib/evidence-gap-detection";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/evidence-gap-detection
 *
 * Daily (pg_cron job evidence-gap-detection, 10:35 UTC). Scans every student
 * with an active class enrollment for unmet required class items
 * (certifications, orientation items, forms, courses), opens one
 * evidence_gap StudentAlert per unmet item, escalates it to high once the
 * enrollment is 14+ days old, and resolves open ones whose item is now met.
 * The intervention queue's evidenceGapCount counts these alerts, and this job
 * is their only writer.
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
    const summary = await runEvidenceGapDetection(now);
    logger.info("Evidence gap detection complete", { ...summary, durationMs: Date.now() - start });
    return NextResponse.json({ ...summary, timestamp: now.toISOString() });
  } catch (error: unknown) {
    logger.error("Evidence gap detection failed", { error: errorForLog(error) });
    return NextResponse.json({ error: "Evidence gap detection failed" }, { status: 500 });
  }
}
