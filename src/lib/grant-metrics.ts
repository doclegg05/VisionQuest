import { prisma } from "@/lib/db";
import { classIdsInRegion } from "@/lib/region";

export type GrantMetric = "enrollments" | "certifications" | "placements" | "ged_earned" | "custom";

export const GRANT_METRICS: readonly GrantMetric[] = [
  "enrollments",
  "certifications",
  "placements",
  "ged_earned",
  "custom",
] as const;

export interface GrantGoalRow {
  id: string;
  metric: GrantMetric;
  programType: string;
  targetValue: number;
  actualValue: number;
  periodStart: Date;
  periodEnd: Date;
  notes: string | null;
  /** "on_track" | "at_risk" | "behind" — simple thresholds so the UI stays consistent. */
  status: "on_track" | "at_risk" | "behind" | "not_started";
}

export interface RegionRollup {
  regionId: string;
  regionName: string;
  periodStart: Date;
  periodEnd: Date;
  headline: {
    activeStudents: number;
    enrollmentsInPeriod: number;
    certificationsInPeriod: number;
    placementsInPeriod: number;
    gedEarnedInPeriod: number;
  };
  grantGoals: GrantGoalRow[];
  classCount: number;
}

interface PeriodBounds {
  start: Date;
  end: Date;
}

export function currentMonthBounds(reference: Date = new Date()): PeriodBounds {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Derives actuals for a given metric within a period, scoped to a region.
 * Period bounds are inclusive on start, exclusive on end (so monthly
 * periods tile without double-counting boundary days).
 */
export async function computeActual(
  metric: GrantMetric,
  options: {
    regionId: string;
    programType: string; // "all" passes through as no filter
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<number> {
  const classIds = await classIdsInRegion(options.regionId);
  if (classIds.length === 0) return 0;

  const programFilter =
    options.programType === "all" ? {} : { programType: options.programType };

  switch (metric) {
    case "enrollments": {
      return prisma.studentClassEnrollment.count({
        where: {
          class: { id: { in: classIds }, ...programFilter },
          enrolledAt: { gte: options.periodStart, lt: options.periodEnd },
          status: { in: ["active", "completed"] },
        },
      });
    }
    case "certifications": {
      return prisma.certification.count({
        where: {
          status: "completed",
          completedAt: { gte: options.periodStart, lt: options.periodEnd },
          student: {
            classEnrollments: {
              some: { class: { id: { in: classIds }, ...programFilter } },
            },
          },
        },
      });
    }
    case "placements": {
      return prisma.application.count({
        where: {
          status: "placed",
          updatedAt: { gte: options.periodStart, lt: options.periodEnd },
          student: {
            classEnrollments: {
              some: { class: { id: { in: classIds }, ...programFilter } },
            },
          },
        },
      });
    }
    case "ged_earned":
    case "custom": {
      // ged_earned and custom metrics don't have an automatic data source yet.
      // Callers may override the actual by storing it in GrantGoal.notes for
      // now or wiring new data sources later. Return 0 so the dashboard still
      // renders the target and shows a "—" actual value.
      return 0;
    }
  }
}

function computeGoalStatus(
  actualValue: number,
  targetValue: number,
  periodStart: Date,
  periodEnd: Date,
  now: Date = new Date(),
): GrantGoalRow["status"] {
  if (targetValue <= 0) return "not_started";
  if (actualValue >= targetValue) return "on_track";

  // Expected progress = fraction of the period elapsed.
  const total = periodEnd.getTime() - periodStart.getTime();
  const elapsed = Math.min(Math.max(now.getTime() - periodStart.getTime(), 0), total);
  const expectedRatio = total > 0 ? elapsed / total : 1;
  const actualRatio = actualValue / targetValue;

  if (actualRatio >= expectedRatio * 0.9) return "on_track";
  if (actualRatio >= expectedRatio * 0.6) return "at_risk";
  return "behind";
}

/**
 * Returns a full region rollup for dashboard consumption. `now` is injectable
 * so tests can pin the reference date.
 */
export async function getRegionRollup(
  regionId: string,
  period: PeriodBounds = currentMonthBounds(),
  now: Date = new Date(),
): Promise<RegionRollup | null> {
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true, name: true },
  });
  if (!region) return null;

  const classIds = await classIdsInRegion(regionId);

  const [
    activeStudents,
    enrollmentsInPeriod,
    certificationsInPeriod,
    placementsInPeriod,
    gedEarnedInPeriod,
    grantGoals,
  ] = await Promise.all([
    prisma.studentClassEnrollment.count({
      where: {
        classId: { in: classIds },
        status: "active",
        student: { isActive: true },
      },
    }),
    computeActual("enrollments", {
      regionId,
      programType: "all",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    computeActual("certifications", {
      regionId,
      programType: "all",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    computeActual("placements", {
      regionId,
      programType: "all",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    computeActual("ged_earned", {
      regionId,
      programType: "all",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    prisma.grantGoal.findMany({
      where: {
        regionId,
        periodStart: { lte: period.end },
        periodEnd: { gte: period.start },
      },
      orderBy: { periodStart: "desc" },
    }),
  ]);

  const grantGoalRows: GrantGoalRow[] = await Promise.all(
    grantGoals.map(async (goal) => {
      const actualValue = await computeActual(goal.metric as GrantMetric, {
        regionId: goal.regionId,
        programType: goal.programType,
        periodStart: goal.periodStart,
        periodEnd: goal.periodEnd,
      });
      return {
        id: goal.id,
        metric: goal.metric as GrantMetric,
        programType: goal.programType,
        targetValue: goal.targetValue,
        actualValue,
        periodStart: goal.periodStart,
        periodEnd: goal.periodEnd,
        notes: goal.notes,
        status: computeGoalStatus(actualValue, goal.targetValue, goal.periodStart, goal.periodEnd, now),
      };
    }),
  );

  return {
    regionId,
    regionName: region.name,
    periodStart: period.start,
    periodEnd: period.end,
    headline: {
      activeStudents,
      enrollmentsInPeriod,
      certificationsInPeriod,
      placementsInPeriod,
      gedEarnedInPeriod,
    },
    grantGoals: grantGoalRows,
    classCount: classIds.length,
  };
}

// Export for testing.
export const __private = { computeGoalStatus };
