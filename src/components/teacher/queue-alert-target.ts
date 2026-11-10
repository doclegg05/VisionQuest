import { isUrgentSeverity } from "@/lib/alert-severity";
import type { InterventionQueueEntry } from "@/lib/teacher/intervention-queue";
import type { QueueUndoTarget } from "./queue-undo";

/** The parts of a queue row these helpers read. */
type QueueRowAlerts = Pick<InterventionQueueEntry, "name" | "openAlerts">;

/**
 * The alert a pill belongs to, with the title and student name its confirm shows. An alert not found on screen is
 * treated as critical, so it asks before acting.
 */
export function findAlertTarget(queue: readonly QueueRowAlerts[], alertId: string): QueueUndoTarget {
  for (const student of queue) {
    const alert = student.openAlerts.find((open) => open.id === alertId);
    if (alert) return { id: alert.id, severity: alert.severity, title: alert.title, studentName: student.name };
  }
  return { id: alertId, severity: "critical", title: "this alert", studentName: "this student" };
}

/** Students with an urgent alert still open. A line shown as done does not count. */
export function countUrgentStudents(
  queue: readonly QueueRowAlerts[],
  isDone: (alertId: string) => boolean,
): number {
  return queue.filter((student) =>
    student.openAlerts.some((alert) => isUrgentSeverity(alert.severity) && !isDone(alert.id)),
  ).length;
}
