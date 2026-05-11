import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { classIdsInRegion } from "@/lib/region";

const CONFIRMATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface GoalProposalMetricRow {
  status: string;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface GoalProposalConfirmationMetrics {
  totalProposed: number;
  pending: number;
  confirmed: number;
  dismissed: number;
  confirmationRate: number;
  confirmedWithin14Days: number;
  confirmationRateWithin14Days: number;
  averageDaysToConfirmation: number | null;
  periodStart: Date;
  periodEnd: Date;
}

export function computeGoalProposalMetrics(
  rows: GoalProposalMetricRow[],
  period: { start: Date; end: Date },
): GoalProposalConfirmationMetrics {
  const totalProposed = rows.length;
  const pending = rows.filter((row) => row.status === "proposed").length;
  const dismissed = rows.filter((row) => row.status === "abandoned").length;
  const confirmedRows = rows.filter((row) =>
    Boolean(row.confirmedAt) || row.status === "confirmed" || row.status === "completed",
  );
  const confirmedWithin14Days = rows.filter((row) =>
    row.confirmedAt !== null &&
    row.confirmedAt.getTime() - row.createdAt.getTime() <= CONFIRMATION_WINDOW_MS,
  ).length;

  const confirmationDurations = rows
    .filter((row) => row.confirmedAt !== null)
    .map((row) => row.confirmedAt!.getTime() - row.createdAt.getTime())
    .filter((duration) => duration >= 0);

  const averageDaysToConfirmation =
    confirmationDurations.length === 0
      ? null
      : confirmationDurations.reduce((sum, duration) => sum + duration, 0) /
        confirmationDurations.length /
        (24 * 60 * 60 * 1000);

  return {
    totalProposed,
    pending,
    confirmed: confirmedRows.length,
    dismissed,
    confirmationRate: totalProposed > 0 ? confirmedRows.length / totalProposed : 0,
    confirmedWithin14Days,
    confirmationRateWithin14Days:
      totalProposed > 0 ? confirmedWithin14Days / totalProposed : 0,
    averageDaysToConfirmation,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

export async function getGoalProposalConfirmationMetrics(options: {
  studentId?: string;
  regionId?: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<GoalProposalConfirmationMetrics> {
  const where: Prisma.GoalWhereInput = {
    sourceMessageId: { not: null },
    createdAt: { gte: options.periodStart, lt: options.periodEnd },
  };

  if (options.studentId) {
    where.studentId = options.studentId;
  }

  if (options.regionId) {
    const classIds = await classIdsInRegion(options.regionId);
    if (classIds.length === 0) {
      return computeGoalProposalMetrics([], {
        start: options.periodStart,
        end: options.periodEnd,
      });
    }
    where.student = {
      classEnrollments: {
        some: {
          classId: { in: classIds },
          status: { in: ["active", "completed"] },
        },
      },
    };
  }

  const rows = await prisma.goal.findMany({
    where,
    select: {
      status: true,
      createdAt: true,
      confirmedAt: true,
    },
  });

  return computeGoalProposalMetrics(rows, {
    start: options.periodStart,
    end: options.periodEnd,
  });
}

export const __private = { CONFIRMATION_WINDOW_MS };
