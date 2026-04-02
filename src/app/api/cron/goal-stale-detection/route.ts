import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isGoalStale, type GoalForStalenessCheck } from "@/lib/stale-goal-rules";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured → open access (development / unconfigured environments)
  if (!secret) return true;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/cron/goal-stale-detection
 *
 * Cron endpoint that scans all active goals for staleness using
 * level-aware thresholds (daily: 3d, weekly: 7d, monthly: 14d, etc.).
 *
 * For each stale goal, creates or updates a StudentAlert with type "goal_stale".
 * Resolves alerts for goals that are no longer stale.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const now = new Date();

  try {
    // Fetch all non-terminal goals with their student ID
    const goals = await prisma.goal.findMany({
      where: {
        status: { notIn: ["completed", "archived", "cancelled"] },
      },
      select: {
        id: true,
        studentId: true,
        level: true,
        status: true,
        updatedAt: true,
      },
    });

    // Check each goal against level-aware staleness thresholds.
    // The Goal model does not have a lastReviewedAt field, so we
    // pass null and let isGoalStale fall back to updatedAt.
    const staleGoals: Array<{ id: string; studentId: string; level: string; daysSinceUpdate: number }> = [];

    for (const goal of goals) {
      const check: GoalForStalenessCheck = {
        level: goal.level,
        status: goal.status,
        updatedAt: goal.updatedAt,
        lastReviewedAt: null,
      };

      if (isGoalStale(check, now)) {
        const daysSinceUpdate = Math.floor(
          (now.getTime() - goal.updatedAt.getTime()) / 86400000
        );
        staleGoals.push({
          id: goal.id,
          studentId: goal.studentId,
          level: goal.level,
          daysSinceUpdate,
        });
      }
    }

    // Upsert alerts for stale goals; resolve alerts for goals no longer stale
    const staleGoalIds = new Set(staleGoals.map((g) => g.id));

    let newAlerts = 0;

    await prisma.$transaction(async (tx) => {
      // Determine which alert keys already exist so we can count net-new ones
      const staleAlertKeys = staleGoals.map((g) => `goal_stale:${g.id}`);
      const existingKeys = new Set(
        (
          await tx.studentAlert.findMany({
            where: { alertKey: { in: staleAlertKeys } },
            select: { alertKey: true },
          })
        ).map((a) => a.alertKey),
      );

      // Create or reopen alerts for stale goals
      for (const goal of staleGoals) {
        const alertKey = `goal_stale:${goal.id}`;
        const severity = goal.daysSinceUpdate >= 14 ? "high" : "medium";
        const levelLabel = goal.level.charAt(0).toUpperCase() + goal.level.slice(1);

        await tx.studentAlert.upsert({
          where: { alertKey },
          update: {
            severity,
            status: "open",
            title: `${levelLabel} goal needs review`,
            summary: `${levelLabel} goal has not been updated in ${goal.daysSinceUpdate} days.`,
            sourceType: "goal",
            sourceId: goal.id,
          },
          create: {
            studentId: goal.studentId,
            alertKey,
            type: "goal_stale",
            severity,
            status: "open",
            title: `${levelLabel} goal needs review`,
            summary: `${levelLabel} goal has not been updated in ${goal.daysSinceUpdate} days.`,
            sourceType: "goal",
            sourceId: goal.id,
          },
        });

        if (!existingKeys.has(alertKey)) {
          newAlerts += 1;
        }
      }

      // Resolve stale-goal alerts whose goals are no longer stale.
      // Only resolve "open" alerts (preserve snoozed/dismissed state).
      const openStaleAlerts = await tx.studentAlert.findMany({
        where: {
          type: "goal_stale",
          status: "open",
        },
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
    });

    const durationMs = Date.now() - start;

    logger.info("Stale goal detection complete", {
      scanned: goals.length,
      newAlerts,
      durationMs,
    });

    return NextResponse.json({
      scanned: goals.length,
      newAlerts,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Stale goal detection failed", { error: message });

    return NextResponse.json(
      { error: "Stale goal detection failed", detail: message },
      { status: 500 }
    );
  }
}
