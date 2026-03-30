/**
 * Grant KPI snapshot — captures a point-in-time snapshot of grant metrics
 * for historical trend tracking. Run monthly via background job.
 */

import { prisma } from "./db";
import { computeGrantKpis, currentProgramYear, type GrantKpiPayload } from "./grant-kpi";
import { logger } from "./logger";

/**
 * Take a snapshot of current grant KPI metrics and persist to GrantKpiSnapshot.
 * Uses the current date as snapshotDate and derives programYear automatically.
 * Optional classId scopes the snapshot to a specific class's students.
 *
 * Deduplicates by (programYear, snapshotDate, classId) — safe to call multiple times.
 */
export async function takeGrantKpiSnapshot(classId?: string): Promise<void> {
  const now = new Date();
  const programYear = currentProgramYear(now);
  const snapshotDate = new Date(now.toISOString().slice(0, 10)); // date only

  const pyNum = parseInt(programYear.replace("PY", ""), 10);
  const startDate = new Date(`${pyNum - 1}-07-01`);
  const endDate = new Date(`${pyNum}-07-01`);

  const records = await prisma.spokesRecord.findMany({
    where: {
      referralDate: { gte: startDate, lt: endDate },
    },
    select: {
      id: true,
      status: true,
      referralDate: true,
      enrolledAt: true,
      unsubsidizedEmploymentAt: true,
      hourlyWage: true,
      postSecondaryEnteredAt: true,
      employmentFollowUps: {
        select: { checkpointMonths: true, status: true },
      },
    },
  });

  const payload: GrantKpiPayload = computeGrantKpis(records);

  // Upsert by checking for existing snapshot first (nullable classId in unique constraint)
  const existing = await prisma.grantKpiSnapshot.findFirst({
    where: { programYear, snapshotDate, classId: classId ?? null },
    select: { id: true },
  });

  if (existing) {
    await prisma.grantKpiSnapshot.update({
      where: { id: existing.id },
      data: {
        metrics: JSON.stringify(payload.metrics),
        counts: JSON.stringify(payload.counts),
      },
    });
  } else {
    await prisma.grantKpiSnapshot.create({
      data: {
        programYear,
        snapshotDate,
        classId: classId ?? null,
        metrics: JSON.stringify(payload.metrics),
        counts: JSON.stringify(payload.counts),
      },
    });
  }

  logger.info("Grant KPI snapshot saved", { programYear, snapshotDate: snapshotDate.toISOString(), classId });
}

/**
 * Retrieve historical snapshots for a given program year.
 */
export async function getGrantKpiHistory(
  programYear: string,
  classId?: string,
): Promise<Array<{ snapshotDate: Date; metrics: GrantKpiPayload["metrics"]; counts: GrantKpiPayload["counts"] }>> {
  const snapshots = await prisma.grantKpiSnapshot.findMany({
    where: {
      programYear,
      classId: classId ?? null,
    },
    orderBy: { snapshotDate: "asc" },
    select: {
      snapshotDate: true,
      metrics: true,
      counts: true,
    },
  });

  return snapshots.map((s) => ({
    snapshotDate: s.snapshotDate,
    metrics: JSON.parse(s.metrics) as GrantKpiPayload["metrics"],
    counts: JSON.parse(s.counts) as GrantKpiPayload["counts"],
  }));
}
