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
 *
 * detectedAt marks when the current spell of the alert began: queue ordering
 * and the instructor resolution-time metric read it. A new or reopened alert
 * starts a spell at `now`; an alert that is already open keeps its date.
 *
 * `prev` is what the detector read earlier in its transaction. The status
 * change only applies while the row still holds that state, so a teacher's
 * dismiss or snooze that commits after the read is kept (PR #248 review):
 * Postgres re-checks an UPDATE's WHERE against the latest committed row.
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

  if (!prev) {
    // A row that appeared since the read gets text only: its state is unknown.
    await tx.studentAlert.upsert({
      where: { alertKey: alert.alertKey },
      update: text,
      create: {
        studentId: alert.studentId,
        alertKey: alert.alertKey,
        type: alert.type,
        ...text,
        status: "open",
        detectedAt: now,
      },
    });
    return;
  }

  if (!isHeldByTeacher(prev, now)) {
    const reopening = prev.status !== "open";
    const { count } = await tx.studentAlert.updateMany({
      where: { alertKey: alert.alertKey, status: prev.status, snoozedUntil: prev.snoozedUntil },
      data: {
        ...text,
        status: "open",
        ...(reopening ? { detectedAt: now } : {}),
        resolvedAt: null,
        snoozedUntil: null,
        snoozedBy: null,
      },
    });
    if (count > 0) return;
  }

  // Held by a teacher, or changed since the read: keep its status.
  await tx.studentAlert.update({ where: { alertKey: alert.alertKey }, data: text });
}
