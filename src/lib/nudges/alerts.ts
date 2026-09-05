// =============================================================================
// Writing the nudge rules' StudentAlert rows.
//
// StudentAlert is the staff intervention queue, keyed by the student the alert
// is ABOUT; an instructor sees it through `managed_student_ids()`. Three of the
// four types here are staff-only and deliberately absent from
// STUDENT_VISIBLE_ALERT_TYPES; the fourth, `connect_weekly_jobs_ready`, is the
// one the student asked for by texting back Y, and is in that allowlist.
//
// These rows are written and cleared HERE rather than through
// applyStudentAlertSyncPlan, because that function resolves anything not in
// its desired set — and its `existing` query lists the types it owns, which
// does not include these. Two writers, disjoint type sets, no interference.
// Each rule is idempotent on `alertKey`, the table's unique column.
//
// Every call must already be inside the student's RLS context: these are the
// student's own rows and the app client fails closed without one.
// =============================================================================

import { prisma } from "@/lib/db";

import type { NudgeAlertPlan } from "./schedule-shared";

/** Raise or refresh one alert. Idempotent on alertKey. */
export async function upsertNudgeAlert(plan: NudgeAlertPlan, now: Date): Promise<void> {
  await prisma.studentAlert.upsert({
    where: { alertKey: plan.alertKey },
    update: {
      severity: plan.severity,
      title: plan.title,
      summary: plan.summary,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId,
    },
    create: {
      studentId: plan.studentId,
      alertKey: plan.alertKey,
      type: plan.type,
      severity: plan.severity,
      status: "open",
      title: plan.title,
      summary: plan.summary,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId,
      detectedAt: now,
    },
  });
}

/**
 * Close an alert whose condition no longer holds — the employer opened the
 * link, or answered.
 *
 * `updateMany` rather than `update` so a key that was never raised is a no-op
 * instead of a P2025, and `status: "open"` in the filter so a teacher who has
 * already dismissed or snoozed one does not have it quietly rewritten.
 */
export async function resolveNudgeAlerts(alertKeys: string[], now: Date): Promise<number> {
  if (alertKeys.length === 0) return 0;
  const result = await prisma.studentAlert.updateMany({
    where: { alertKey: { in: alertKeys }, status: "open" },
    data: { status: "resolved", resolvedAt: now },
  });
  return result.count;
}
