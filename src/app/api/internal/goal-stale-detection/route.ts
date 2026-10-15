import { NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/csrf";
import { prismaAdmin as prisma } from "@/lib/db";
import { buildGoalStaleAlert, TERMINAL_GOAL_STATUSES, type GoalStaleAlert } from "@/lib/stale-goal-rules";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// One transaction holds every upsert of a program-wide run, so Prisma's 5 s
// default is too short. The pg_cron job waits 120 s (timeout_milliseconds in
// 20261015120000_add_stall_detector_cron), longer than this.
const TRANSACTION_OPTIONS = { timeout: 90_000, maxWait: 10_000 };

type StaleGoalAlert = GoalStaleAlert & { studentId: string };

async function findStaleGoalAlerts(now: Date): Promise<{ scanned: number; stale: StaleGoalAlert[] }> {
  const goals = await prisma.goal.findMany({
    where: { status: { notIn: [...TERMINAL_GOAL_STATUSES] } },
    select: {
      id: true,
      studentId: true,
      level: true,
      status: true,
      updatedAt: true,
      lastReviewedAt: true,
    },
  });

  const stale = goals.flatMap((goal) => {
    const alert = buildGoalStaleAlert(goal, now);
    return alert ? [{ ...alert, studentId: goal.studentId }] : [];
  });
  return { scanned: goals.length, stale };
}

/** Upserts the stale goals' alerts and resolves the rest; returns how many are new. */
async function syncGoalStaleAlerts(stale: StaleGoalAlert[], now: Date): Promise<number> {
  const staleGoalIds = new Set(stale.map((alert) => alert.sourceId));

  return prisma.$transaction(async (tx) => {
    const existingKeys = new Set(
      (
        await tx.studentAlert.findMany({
          where: { alertKey: { in: stale.map((alert) => alert.alertKey) } },
          select: { alertKey: true },
        })
      ).map((a) => a.alertKey),
    );

    for (const { studentId, ...alert } of stale) {
      const fields = {
        severity: alert.severity,
        status: "open",
        title: alert.title,
        summary: alert.summary,
        sourceType: alert.sourceType,
        sourceId: alert.sourceId,
      };
      await tx.studentAlert.upsert({
        where: { alertKey: alert.alertKey },
        update: fields,
        create: { studentId, alertKey: alert.alertKey, type: alert.type, ...fields },
      });
    }

    // Resolve only "open" alerts, so snoozed and dismissed ones keep their state.
    const openStaleAlerts = await tx.studentAlert.findMany({
      where: { type: "goal_stale", status: "open" },
      select: { id: true, sourceId: true },
    });
    const toResolve = openStaleAlerts
      .filter((a) => a.sourceId && !staleGoalIds.has(a.sourceId))
      .map((a) => a.id);
    if (toResolve.length > 0) {
      await tx.studentAlert.updateMany({
        where: { id: { in: toResolve } },
        data: { status: "resolved", resolvedAt: now },
      });
    }

    return stale.filter((alert) => !existingKeys.has(alert.alertKey)).length;
  }, TRANSACTION_OPTIONS);
}

/**
 * POST /api/internal/goal-stale-detection
 *
 * Daily (pg_cron job goal-stale-detection, 10:45 UTC). Scans every
 * non-terminal goal with the level-aware rule the intervention queue uses
 * (daily 3 days, weekly 7, monthly 14, quarterly 30, BHAG 60, measured from
 * the last review, else the last update), opens a goal_stale StudentAlert for
 * each stale goal, and resolves open ones whose goals are no longer stale.
 * The alert sync builds the same alert on activity; this job covers students
 * with no activity to trigger it.
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
    const { scanned, stale } = await findStaleGoalAlerts(now);
    const newAlerts = await syncGoalStaleAlerts(stale, now);

    logger.info("Stale goal detection complete", {
      scanned,
      newAlerts,
      durationMs: Date.now() - start,
    });

    return NextResponse.json({
      scanned,
      newAlerts,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Stale goal detection failed", { error: message });

    return NextResponse.json(
      {
        error: "Stale goal detection failed",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 },
    );
  }
}
