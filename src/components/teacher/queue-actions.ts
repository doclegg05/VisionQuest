import type { DashboardQuickActionKind } from "@/lib/intervention-notifications";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import type { DashboardActionIntent } from "./DashboardActionPanel";

/** The action-panel intent for one alert, or null when the panel cannot act on it. */
export function buildAlertActionIntent(
  student: InterventionQueueEntry,
  alert: QueueAlert,
  kind: DashboardQuickActionKind,
): DashboardActionIntent | null {
  if (kind === "assign_support" && alert.sourceType !== "goal") return null;
  return {
    kind,
    title: alert.title,
    summary: alert.summary,
    severity: alert.severity,
    student: { id: student.studentId, studentId: student.publicStudentId, displayName: student.name },
    alertId: alert.id,
    goalId: alert.sourceType === "goal" ? alert.sourceId : null,
    linkId: alert.sourceType === "goal_resource_link" ? alert.sourceId : null,
  };
}

export type MainActionMode =
  | { mode: "panel"; intent: DashboardActionIntent }
  | { mode: "task" }
  | { mode: "link"; href: string };

/** What the row's main button does: open the action panel, open the task form, or go to a page. */
export function mainActionMode(student: InterventionQueueEntry): MainActionMode {
  const { kind, href } = student.recommendedAction;
  const intent =
    student.primaryAlert && kind ? buildAlertActionIntent(student, student.primaryAlert, kind) : null;
  if (intent) return { mode: "panel", intent };
  if (kind === "create_task") return { mode: "task" };
  return { mode: "link", href };
}
