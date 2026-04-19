import { forbidden, notFound } from "@/lib/api-error";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { csvEscape } from "@/lib/forms/export";
import {
  currentMonthBounds,
  getRegionRollup,
  type GrantGoalRow,
} from "@/lib/grant-metrics";
import { listInstructorMetricsForRegion } from "@/lib/instructor-metrics";
import { coordinatorHasRegion } from "@/lib/region";

interface RouteContext {
  params: Promise<{ regionId: string }>;
}

export const GET = withCoordinatorAuth(
  "coordinator.forms.export",
  async (session, req: Request, ctx: RouteContext) => {
    const { regionId } = await ctx.params;
    const authorized = await coordinatorHasRegion(session, regionId);
    if (!authorized) throw forbidden("You are not assigned to this region.");

    const url = new URL(req.url);
    const period = resolvePeriod(url);

    const [rollup, instructorMetrics] = await Promise.all([
      getRegionRollup(regionId, period),
      listInstructorMetricsForRegion(regionId),
    ]);
    if (!rollup) throw notFound("Region not found.");

    const periodLabel = periodToLabel(period.start, period.end);
    const lines: string[] = [];

    lines.push("# Monthly region summary");
    lines.push(`# Region: ${rollup.regionName}`);
    lines.push(`# Period: ${periodLabel}`);
    lines.push(`# Classes in region: ${rollup.classCount}`);
    lines.push("");

    lines.push("Section,Metric,Value");
    lines.push(`Headline,Active students,${rollup.headline.activeStudents}`);
    lines.push(`Headline,Enrollments in period,${rollup.headline.enrollmentsInPeriod}`);
    lines.push(`Headline,Certifications in period,${rollup.headline.certificationsInPeriod}`);
    lines.push(`Headline,Placements in period,${rollup.headline.placementsInPeriod}`);
    lines.push(`Headline,GED earned in period,${rollup.headline.gedEarnedInPeriod}`);
    lines.push("");

    lines.push("Grant targets,Metric,Program,Target,Actual,Status");
    for (const goal of rollup.grantGoals) {
      lines.push(grantGoalRow(goal));
    }
    lines.push("");

    lines.push("Instructor metrics,Name,Active students,Classes,Cert pass rate,Form completion,Alert response (days)");
    for (const row of instructorMetrics) {
      lines.push(
        [
          "Instructor",
          csvEscape(row.instructor.displayName),
          row.activeStudents,
          row.classCount,
          formatRate(row.certPassRate),
          formatRate(row.formCompletionRate),
          row.alertResponseDays ?? "",
        ].join(","),
      );
    }

    const filenameRegion = rollup.regionName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "region";
    const filenamePeriod = period.start.toISOString().slice(0, 7);
    const body = `${lines.join("\n")}\n`;

    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="region-${filenameRegion}-${filenamePeriod}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  },
);

function grantGoalRow(goal: GrantGoalRow): string {
  return [
    "Grant",
    csvEscape(goal.metric),
    csvEscape(goal.programType),
    goal.targetValue,
    goal.actualValue,
    csvEscape(goal.status),
  ].join(",");
}

function formatRate(value: number | null): string {
  if (value === null) return "";
  return `${Math.round(value * 1000) / 10}%`;
}

function periodToLabel(start: Date, end: Date): string {
  return `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
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
