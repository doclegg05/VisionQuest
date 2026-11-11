import type { AlertSummary } from "@/lib/sage/context-bundle";
import { STUDENT_VISIBLE_ALERT_TYPES } from "@/lib/student-alerts";

const STUDENT_VISIBLE_ALERT_TYPE_SET: ReadonlySet<string> = new Set(STUDENT_VISIBLE_ALERT_TYPES);

/**
 * Alert descriptors a student may read. bundle.alerts is built from the
 * staff-facing advising descriptors (inactivity stages say "consider
 * archiving", certification stalls name the instructor's next step), and
 * without this filter those lines reached the student's own Sage prompt. Only
 * the types whose copy is written for the student pass (the same set the
 * Advising page shows). With today's bundle inputs (no tasks or appointments
 * are passed to the descriptor builder) that is no alerts at all.
 */
export function studentVisibleAlerts(alerts: readonly AlertSummary[] | undefined): AlertSummary[] {
  return (alerts ?? []).filter((alert) => STUDENT_VISIBLE_ALERT_TYPE_SET.has(alert.type));
}
