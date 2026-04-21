import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface CronFailure {
  jobid: number;
  jobname: string;
  runid: number;
  status: string;
  return_message: string | null;
  start_time: string;
  end_time: string;
}

/**
 * POST /api/internal/cron-health
 *
 * Receives failure reports from the `cron-health-monitor` pg_cron job. The
 * monitor runs hourly, queries `cron.job_run_details` for non-successful runs
 * in the previous hour, and POSTs any failures here.
 *
 * Auth: Bearer CRON_SECRET
 *
 * TODO (escalation policy): currently logs every failure to Sentry as an
 * error-level message. If cron noise becomes a problem we may want to:
 *   - Only escalate after N consecutive failures of the same jobname
 *   - Send a Slack/email alert for repeated failures in addition to Sentry
 *   - Suppress duplicates within a rolling window
 * Revisit once we have a week of production data.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { failures?: CronFailure[] } | null;
  const failures = body?.failures ?? [];

  if (failures.length === 0) {
    return NextResponse.json({ received: 0 });
  }

  for (const failure of failures) {
    logger.error("pg_cron job failed", {
      jobname: failure.jobname,
      status: failure.status,
      returnMessage: failure.return_message,
      startTime: failure.start_time,
      endTime: failure.end_time,
    });
    Sentry.captureMessage(`pg_cron job "${failure.jobname}" failed`, {
      level: "error",
      tags: { jobname: failure.jobname, status: failure.status },
      extra: {
        return_message: failure.return_message,
        start_time: failure.start_time,
        end_time: failure.end_time,
      },
    });
  }

  return NextResponse.json({ received: failures.length });
}
