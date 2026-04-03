import { type StudentStatusSignals } from "./student-status";
import { getDaysSinceActivity, getInactivityStage } from "./inactivity";

export interface AlertDescriptor {
  alertKey: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
}

export interface AlertInputs {
  tasks: Array<{
    id: string;
    title: string;
    dueAt: Date | null;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
  }>;
  signals?: {
    studentId?: string;
    studentCreatedAt?: Date | null;
    lastActivityAt?: Date | null;
    applicationCount?: number;
    eventRegistrationCount?: number;
    orientationStatus?: StudentStatusSignals | null;
    certification?: {
      status: string | null;
      startedAt: Date | null;
      lastProgressAt: Date | null;
      completedRequiredCount: number;
      requiredCount: number;
    } | null;
    goals?: {
      id: string;
      level: string;
      status: string;
      updatedAt: Date;
    }[];
    lastConversationAt?: Date | null;
    orientationComplete?: boolean;
  };
  now?: Date;
}

function formatAlertDate(value: Date) {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

export function buildStudentAlertDescriptors({
  tasks,
  appointments,
  signals,
  now = new Date(),
}: AlertInputs): AlertDescriptor[] {
  const alerts: AlertDescriptor[] = [];

  for (const task of tasks) {
    if (!task.dueAt || task.dueAt >= now) continue;

    const hoursOverdue = (now.getTime() - task.dueAt.getTime()) / 36e5;
    alerts.push({
      alertKey: `overdue_task:${task.id}`,
      type: "overdue_task",
      severity: hoursOverdue >= 48 ? "high" : "medium",
      title: "Overdue follow-up task",
      summary: `"${task.title}" was due ${formatAlertDate(task.dueAt)}.`,
      sourceType: "task",
      sourceId: task.id,
    });
  }

  for (const appointment of appointments) {
    if (appointment.endsAt >= now) continue;

    alerts.push({
      alertKey: `missed_appointment:${appointment.id}`,
      type: "missed_appointment",
      severity: "high",
      title: "Past-due appointment follow-up",
      summary: `"${appointment.title}" ended ${formatAlertDate(appointment.endsAt)} and still needs a status update.`,
      sourceType: "appointment",
      sourceId: appointment.id,
    });
  }

  const studentKey = signals?.studentId || "student";
  const lastActivityAt = latestDate(signals?.lastActivityAt, signals?.studentCreatedAt);
  if (lastActivityAt) {
    const inactivityStage = getInactivityStage(getDaysSinceActivity(lastActivityAt, now));
    if (inactivityStage) {
      alerts.push({
        alertKey: `inactive_student:${studentKey}`,
        type: inactivityStage.type,
        severity: inactivityStage.severity,
        title: inactivityStage.title,
        summary: `No recorded student activity since ${formatAlertDate(lastActivityAt)}. ${inactivityStage.nextStep}`,
        sourceType: "student",
        sourceId: signals?.studentId || studentKey,
      });
    }
  }

  if (
    signals?.studentCreatedAt &&
    (signals.applicationCount || 0) === 0 &&
    (signals.eventRegistrationCount || 0) === 0
  ) {
    const daysSinceEnrollment =
      (now.getTime() - signals.studentCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceEnrollment >= 21) {
      alerts.push({
        alertKey: `career_inactive:${studentKey}`,
        type: "career_inactive",
        severity: daysSinceEnrollment >= 45 ? "high" : "medium",
        title: "Career activity still needs momentum",
        summary: `No job applications or event registrations have been recorded since enrollment on ${formatAlertDate(signals.studentCreatedAt)}.`,
        sourceType: "student",
        sourceId: signals?.studentId || studentKey,
      });
    }
  }

  const certification = signals?.certification;
  if (
    certification &&
    certification.status !== "completed" &&
    certification.requiredCount > 0 &&
    certification.completedRequiredCount < certification.requiredCount
  ) {
    const referenceDate = latestDate(certification.lastProgressAt, certification.startedAt, signals?.studentCreatedAt);
    if (referenceDate) {
      const stalledDays = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
      if (stalledDays >= 14) {
        alerts.push({
          alertKey: `certification_stalled:${studentKey}`,
          type: "certification_stalled",
          severity: stalledDays >= 28 ? "high" : "medium",
          title: "Certification progress has stalled",
          summary: `Certification progress has not advanced since ${formatAlertDate(referenceDate)}.`,
          sourceType: "certification",
          sourceId: signals?.studentId || studentKey,
        });
      }
    }
  }

  if (signals?.goals && signals.goals.length > 0) {
    const activeGoals = signals.goals.filter((goal) => goal.status === "active" || goal.status === "in_progress");
    for (const goal of activeGoals) {
      const daysSinceUpdate = (now.getTime() - goal.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate >= 7) {
        alerts.push({
          alertKey: `goal_stale:${goal.id}`,
          type: "goal_stale",
          severity: daysSinceUpdate >= 14 ? "high" : "medium",
          title: `${goal.level.charAt(0).toUpperCase() + goal.level.slice(1)} goal needs review`,
          summary: `${goal.level.charAt(0).toUpperCase() + goal.level.slice(1)} goal has not been updated in ${Math.round(daysSinceUpdate)} days.`,
          sourceType: "goal",
          sourceId: goal.id,
        });
      }
    }
  }

  if (signals?.studentCreatedAt && signals.orientationComplete !== true) {
    const enrollDays = (now.getTime() - signals.studentCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (enrollDays >= 3) {
      const hasStarted = signals.goals && signals.goals.length > 0;
      if (!hasStarted && enrollDays >= 3 && enrollDays < 7) {
        alerts.push({
          alertKey: `orientation_not_started:${studentKey}`,
          type: "orientation_not_started",
          severity: "medium",
          title: "Student has not started orientation",
          summary: `Enrolled ${Math.round(enrollDays)} days ago but has not begun the orientation checklist. Reach out to help them get started.`,
          sourceType: "student",
          sourceId: signals.studentId || studentKey,
        });
      } else if (enrollDays >= 7) {
        alerts.push({
          alertKey: `orientation_overdue:${studentKey}`,
          type: "orientation_overdue",
          severity: enrollDays >= 14 ? "high" : "medium",
          title: "Orientation is overdue",
          summary: `Enrolled ${Math.round(enrollDays)} days ago with orientation still incomplete. Follow up to prevent the student from falling behind.`,
          sourceType: "student",
          sourceId: signals.studentId || studentKey,
        });
      }
    }
  }

  const orientationStatus = signals?.orientationStatus;
  const daysSinceEnrollment = signals?.studentCreatedAt
    ? (now.getTime() - signals.studentCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  if (orientationStatus && signals?.studentId) {
    const orientationStarted =
      orientationStatus.requiredForms.approved.length > 0 ||
      orientationStatus.requiredForms.pendingReview.length > 0 ||
      orientationStatus.requiredForms.needsRevision.length > 0 ||
      orientationStatus.orientationChecklist.completedRequired > 0;

    if (
      orientationStatus.requiredForms.missing.length > 0 &&
      (orientationStarted || daysSinceEnrollment >= 2)
    ) {
      const missingForms = orientationStatus.requiredForms.missing.map((item) => item.title);
      alerts.push({
        alertKey: `orientation_form_missing:${signals.studentId}`,
        type: "orientation_form_missing",
        severity: daysSinceEnrollment >= 7 ? "high" : "medium",
        title: "Required onboarding forms are still missing",
        summary:
          missingForms.length > 3
            ? `${missingForms.slice(0, 3).join(", ")}, and ${missingForms.length - 3} more required onboarding forms are still missing.`
            : `${missingForms.join(", ")} still need to be submitted.`,
        sourceType: "student",
        sourceId: signals.studentId,
      });
    }

    if (orientationStatus.requiredForms.pendingReview.length > 0) {
      const oldestPendingAt = orientationStatus.requiredForms.pendingReview.reduce<Date | null>(
        (oldest, item) => {
          const updatedAt = item.updatedAt instanceof Date ? item.updatedAt : item.updatedAt ? new Date(item.updatedAt) : null;
          if (!updatedAt || Number.isNaN(updatedAt.getTime())) return oldest;
          if (!oldest || updatedAt.getTime() < oldest.getTime()) return updatedAt;
          return oldest;
        },
        null,
      );
      const pendingAgeDays = oldestPendingAt
        ? (now.getTime() - oldestPendingAt.getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      const pendingForms = orientationStatus.requiredForms.pendingReview.map((item) => item.title);
      alerts.push({
        alertKey: `orientation_form_pending_review:${signals.studentId}`,
        type: "orientation_form_pending_review",
        severity: pendingAgeDays >= 3 ? "high" : "medium",
        title: "Submitted onboarding forms need review",
        summary:
          pendingForms.length > 3
            ? `${pendingForms.slice(0, 3).join(", ")}, and ${pendingForms.length - 3} more forms are waiting for instructor review.`
            : `${pendingForms.join(", ")} ${pendingForms.length === 1 ? "is" : "are"} waiting for instructor review.`,
        sourceType: "student",
        sourceId: signals.studentId,
      });
    }

    if (orientationStatus.requiredForms.needsRevision.length > 0) {
      const revisionForms = orientationStatus.requiredForms.needsRevision.map((item) => item.title);
      alerts.push({
        alertKey: `orientation_form_revision_needed:${signals.studentId}`,
        type: "orientation_form_revision_needed",
        severity: "medium",
        title: "Onboarding forms were returned for revision",
        summary:
          revisionForms.length > 3
            ? `${revisionForms.slice(0, 3).join(", ")}, and ${revisionForms.length - 3} more forms were returned and still need student follow-up.`
            : `${revisionForms.join(", ")} ${revisionForms.length === 1 ? "was" : "were"} returned and still need student follow-up.`,
        sourceType: "student",
        sourceId: signals.studentId,
      });
    }

    if (
      orientationStatus.orientationChecklist.incompleteRequired.length > 0 &&
      orientationStatus.orientationChecklist.totalRequired > 0 &&
      daysSinceEnrollment >= 7
    ) {
      const incompleteItems = orientationStatus.orientationChecklist.incompleteRequired.map((item) => item.label);
      alerts.push({
        alertKey: `orientation_item_incomplete:${signals.studentId}`,
        type: "orientation_item_incomplete",
        severity: daysSinceEnrollment >= 14 ? "high" : "medium",
        title: "Required orientation steps are still incomplete",
        summary:
          incompleteItems.length > 3
            ? `${incompleteItems.slice(0, 3).join(", ")}, and ${incompleteItems.length - 3} more required orientation steps are still incomplete.`
            : `${incompleteItems.join(", ")} ${incompleteItems.length === 1 ? "is" : "are"} still incomplete.`,
        sourceType: "student",
        sourceId: signals.studentId,
      });
    }
  }

  return alerts;
}
