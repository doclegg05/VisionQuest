import type { Prisma } from "@prisma/client";

export interface AlertHoldState {
  status: string;
  snoozedUntil: Date | null;
}

/**
 * True when a teacher has put this StudentAlert on hold: dismissed it ("won't
 * reappear on resync", PATCH /api/teacher/alerts/:id) or snoozed it until a
 * time still in the future. A writer that recomputes the alert may refresh
 * its text but must leave its status alone. Used by the alert sync
 * (applyStudentAlertSyncPlan) and the daily evidence-gap and goal-stale jobs.
 */
export function isHeldByTeacher(prev: AlertHoldState | undefined, now: Date): boolean {
  if (!prev) return false;
  if (prev.status === "dismissed") return true;
  return prev.status === "snoozed" && prev.snoozedUntil !== null && prev.snoozedUntil > now;
}

export interface DetectedAlert {
  studentId: string;
  alertKey: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
}

/**
 * Writes one alert a scheduled detector found. A held alert gets fresh text
 * only; anything else is opened, clearing an old resolution or an expired
 * snooze, the same as the alert sync does.
 */
export async function writeDetectedAlert(
  tx: Prisma.TransactionClient,
  prev: AlertHoldState | undefined,
  alert: DetectedAlert,
  now: Date,
): Promise<void> {
  const text = {
    severity: alert.severity,
    title: alert.title,
    summary: alert.summary,
    sourceType: alert.sourceType,
    sourceId: alert.sourceId,
  };

  if (isHeldByTeacher(prev, now)) {
    await tx.studentAlert.update({ where: { alertKey: alert.alertKey }, data: text });
    return;
  }

  await tx.studentAlert.upsert({
    where: { alertKey: alert.alertKey },
    update: { ...text, status: "open", resolvedAt: null, snoozedUntil: null, snoozedBy: null },
    create: { studentId: alert.studentId, alertKey: alert.alertKey, type: alert.type, ...text, status: "open" },
  });
}
