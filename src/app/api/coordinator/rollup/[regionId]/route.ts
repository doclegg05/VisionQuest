import { NextResponse } from "next/server";

import { forbidden, notFound } from "@/lib/api-error";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { coordinatorHasRegion, countUnregionedClasses } from "@/lib/region";
import {
  currentMonthBounds,
  getRegionRollup,
  type GrantGoalRow,
} from "@/lib/grant-metrics";
import { listInstructorMetricsForRegion } from "@/lib/instructor-metrics";
import { getGoalProposalConfirmationMetrics } from "@/lib/sage/closed-loop-metrics";

interface RouteContext {
  params: Promise<{ regionId: string }>;
}

export const GET = withCoordinatorAuth(
  "coordinator.dashboard.view",
  async (session, req: Request, ctx: RouteContext) => {
    const { regionId } = await ctx.params;

    const authorized = await coordinatorHasRegion(session, regionId);
    if (!authorized) throw forbidden("You are not assigned to this region.");

    const url = new URL(req.url);
    const period = resolvePeriod(url);

    const [rollup, instructorMetrics, unregionedClasses, sageEffectiveness] = await Promise.all([
      getRegionRollup(regionId, period),
      listInstructorMetricsForRegion(regionId),
      countUnregionedClasses(),
      getGoalProposalConfirmationMetrics({
        regionId,
        periodStart: period.start,
        periodEnd: period.end,
      }),
    ]);

    if (!rollup) throw notFound("Region not found.");

    return NextResponse.json({
      rollup: {
        ...rollup,
        periodStart: rollup.periodStart.toISOString(),
        periodEnd: rollup.periodEnd.toISOString(),
        grantGoals: rollup.grantGoals.map(serializeGrantGoalRow),
      },
      instructorMetrics,
      unregionedClasses,
      sageEffectiveness: {
        ...sageEffectiveness,
        periodStart: sageEffectiveness.periodStart.toISOString(),
        periodEnd: sageEffectiveness.periodEnd.toISOString(),
      },
    });
  },
);

function serializeGrantGoalRow(row: GrantGoalRow) {
  return {
    ...row,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
  };
}

function resolvePeriod(url: URL): { start: Date; end: Date } {
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  if (fromRaw && toRaw) {
    const start = new Date(fromRaw);
    const end = new Date(toRaw);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return { start, end };
    }
  }
  return currentMonthBounds();
}
