import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncAlertsForStudents } from "@/lib/advising";
import { logger } from "@/lib/logger";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/internal/alerts/sync
 *
 * Cron endpoint that syncs alerts for all active students.
 * Runs periodically (e.g., every 15 minutes) to keep alerts fresh
 * without blocking page renders.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
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
