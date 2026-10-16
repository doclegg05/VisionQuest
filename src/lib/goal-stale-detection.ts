/**
 * The daily goal-stale scan behind POST /api/internal/goal-stale-detection.
 * Opens a goal_stale StudentAlert for each stale goal (level-aware rule from
 * stale-goal-rules.ts) and resolves open ones whose goals are no longer stale.
 */
import { writeDetectedAlert } from "@/lib/alert-hold";
import { prismaAdmin as prisma } from "@/lib/db";
import { buildGoalStaleAlert, TERMINAL_GOAL_STATUSES, type GoalStaleAlert } from "@/lib/stale-goal-rules";

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
    const existing = new Map(
      (
        await tx.studentAlert.findMany({
          where: { alertKey: { in: stale.map((alert) => alert.alertKey) } },
          select: { alertKey: true, status: true, snoozedUntil: true },
        })
      ).map((a) => [a.alertKey, a]),
    );

    for (const alert of stale) {
      await writeDetectedAlert(tx, existing.get(alert.alertKey), alert, now);
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

    return stale.filter((alert) => !existing.has(alert.alertKey)).length;
  }, TRANSACTION_OPTIONS);
}

export interface GoalStaleSummary {
  scanned: number;
  newAlerts: number;
}

/** Scans every non-terminal goal and syncs its goal_stale alert. */
export async function runGoalStaleDetection(now: Date): Promise<GoalStaleSummary> {
  const { scanned, stale } = await findStaleGoalAlerts(now);
  const newAlerts = await syncGoalStaleAlerts(stale, now);
  return { scanned, newAlerts };
}
