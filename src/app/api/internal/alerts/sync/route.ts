import { NextResponse } from "next/server";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { prismaAdmin as prisma } from "@/lib/db";
import { syncAlertsForStudents } from "@/lib/advising";
import { logger } from "@/lib/logger";

/**
 * POST /api/internal/alerts/sync
 *
 * Cron endpoint that syncs alerts for all active students, daily at 10:25 UTC
 * (pg_cron job `alert-sync`). Activity already syncs a student's alerts; this
 * sweep writes the ones that turn on only because days pass (inactivity,
 * overdue tasks, missed appointments). It sends no nudges; see
 * syncAlertsForStudents.
 *
 * Auth: Bearer CRON_SECRET. No session: the roster read uses prismaAdmin,
 * and syncAlertsForStudents runs each student's sync as that student.
 */
export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  const studentIds = await prisma.student.findMany({
    where: { role: "student", isActive: true },
    select: { id: true },
  });

  await syncAlertsForStudents(studentIds.map((s) => s.id));

  const duration = Date.now() - start;
  logger.info("Alert sync complete", {
    studentCount: studentIds.length,
    durationMs: duration,
  });

  return NextResponse.json({
    synced: studentIds.length,
    durationMs: duration,
  });
}
