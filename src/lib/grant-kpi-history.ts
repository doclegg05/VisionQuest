import { NON_ARCHIVED_ENROLLMENT_STATUSES } from "./classroom";
import { prisma } from "./db";
import { computeGrantKpis, currentProgramYear, type GrantKpiPayload } from "./grant-kpi";
import { logger } from "./logger";

export async function takeGrantKpiSnapshot(classId?: string): Promise<void> {
  const now = new Date();
  const programYear = currentProgramYear(now);
  const snapshotDate = new Date(now.toISOString().slice(0, 10));

  const pyNum = parseInt(programYear.replace("PY", ""), 10);
  const startDate = new Date(`${pyNum - 1}-07-01`);
  const endDate = new Date(`${pyNum}-07-01`);

  const records = await prisma.spokesRecord.findMany({
    where: {
      referralDate: { gte: startDate, lt: endDate },
      ...(classId
        ? {
            student: {
              is: {
                classEnrollments: {
                  some: {
                    classId,
                    status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
                  },
                },
              },
            },
          }
        : {}),
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

  logger.info("Grant KPI snapshot saved", {
    programYear,
    snapshotDate: snapshotDate.toISOString(),
    classId,
  });
}

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

  return snapshots.map((snapshot) => ({
    snapshotDate: snapshot.snapshotDate,
    metrics: JSON.parse(snapshot.metrics) as GrantKpiPayload["metrics"],
    counts: JSON.parse(snapshot.counts) as GrantKpiPayload["counts"],
  }));
}
