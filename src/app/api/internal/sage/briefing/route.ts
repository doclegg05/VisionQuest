import { NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { isAutopilotEnabled, utcPanelDate } from "@/lib/sage/briefing";

/**
 * Alpha-stage safety cap on per-run fan-out (a handful of real students
 * today). Raising it is an operator decision — the cap is LOGGED when hit,
 * never silent.
 */
const MAX_STUDENTS_PER_RUN = 50;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/internal/sage/briefing
 *
 * Cron endpoint — enqueues one `sage_briefing` background job per active
 * student (the job-processor cron executes them). Runs daily at 11:00 UTC
 * via pg_cron `sage-daily-briefing`.
 *
 * Auth: Bearer CRON_SECRET. Kill switch: SAGE_AUTOPILOT_ENABLED (+ global
 * SAGE_AGENT_MODE), also re-checked inside each job.
 */
async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAutopilotEnabled()) {
    return NextResponse.json({
      success: true,
      data: { disabled: true, enqueued: 0, total: 0 },
    });
  }

  const students = await prisma.student.findMany({
    where: { role: "student", isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const total = students.length;
  const batch = students.slice(0, MAX_STUDENTS_PER_RUN);
  if (total > batch.length) {
    logger.warn("briefing: student count exceeds per-run cap; excess skipped this run", {
      total,
      cap: MAX_STUDENTS_PER_RUN,
    });
  }

  const dateKey = utcPanelDate().toISOString().slice(0, 10);
  let enqueued = 0;
  for (const student of batch) {
    try {
      const jobId = await enqueueJob({
        type: "sage_briefing",
        payload: { studentId: student.id },
        dedupeKey: `sage_briefing:${student.id}:${dateKey}`,
      });
      if (jobId) enqueued++;
    } catch (err) {
      logger.error("briefing: failed to enqueue", {
        studentId: student.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(`briefing: enqueued ${enqueued}/${total} students for ${dateKey}`);
  return NextResponse.json({
    success: true,
    data: { enqueued, total, capped: total > batch.length },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}

/** GET kept for manual operator runs (curl) — identical behavior. */
export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
