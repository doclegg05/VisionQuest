import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { prismaAdmin as prisma } from "@/lib/db";
import { syncAlertsForStudents } from "@/lib/advising";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

const SENTRY_TAGS = { jobname: "alert-sync" };

/**
 * POST /api/internal/alerts/sync
 *
 * Cron endpoint that syncs alerts for all active students, daily at 10:25 UTC
 * (pg_cron job `alert-sync`). Activity already syncs a student's alerts; this
 * sweep writes the ones that turn on only because days pass (inactivity,
 * overdue tasks, missed appointments). It sends no nudges, to staff or to
 * students; see syncAlertsForStudents.
 *
 * Failures answer 500 and go to Sentry. pg_cron records every run as
 * succeeded, and the nightly cron:health check reads only the last six hours
 * of HTTP statuses, so a 10:25 failure would otherwise reach nobody.
 *
 * Auth: Bearer CRON_SECRET. No session: the roster read uses prismaAdmin,
 * and syncAlertsForStudents runs each student's sync as that student.
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const students = await prisma.student.findMany({
      where: { role: "student", isActive: true },
      select: { id: true },
    });

    const summary = await syncAlertsForStudents(students.map((s) => s.id));
    const durationMs = Date.now() - start;
    logger.info("Alert sync complete", { ...summary, durationMs });

    if (summary.failed > 0) {
      Sentry.captureMessage(`Daily alert sync: ${summary.failed} student sync(s) failed`, {
        level: "error",
        tags: SENTRY_TAGS,
        extra: { ...summary, durationMs },
      });
    }
    return NextResponse.json({ ...summary, durationMs }, { status: summary.failed > 0 ? 500 : 200 });
  } catch (error) {
    logger.error("Alert sync failed", { error: errorForLog(error) });
    Sentry.captureMessage("Daily alert sync failed before it finished", {
      level: "error",
      tags: SENTRY_TAGS,
      extra: { error: errorForLog(error) },
    });
    return NextResponse.json({ error: "Alert sync failed" }, { status: 500 });
  }
}
