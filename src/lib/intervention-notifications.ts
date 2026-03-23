import type { GoalEvidenceEntry, GoalReviewQueueItem } from "./goal-evidence";

export interface InterventionAlert {
  type: string;
  title: string;
  summary: string;
}

export interface InterventionNotificationSpec {
  type: string;
  title: string;
  body: string;
  cooldownHours: number;
}

export interface InterventionAction {
  href: string;
  label: string;
}

export const DASHBOARD_QUICK_ACTION_KINDS = [
  "review_forms",
  "create_task",
  "assign_support",
] as const;
export type DashboardQuickActionKind = (typeof DASHBOARD_QUICK_ACTION_KINDS)[number];

export interface DashboardQuickAction {
  kind: DashboardQuickActionKind;
  label: string;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value: Date, now: Date) {
  return (value.getTime() - now.getTime()) / 86400000;
}

function formatDueLabel(value: Date) {
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function buildStudentInterventionNotifications({
  alerts,
  evidenceEntries,
  now = new Date(),
}: {
  alerts: InterventionAlert[];
  evidenceEntries: GoalEvidenceEntry[];
  now?: Date;
}): InterventionNotificationSpec[] {
  const specs: InterventionNotificationSpec[] = [];

  for (const alert of alerts) {
    if (alert.type === "orientation_form_missing") {
      specs.push({
        type: "nudge.orientation_missing",
        title: "You still have onboarding forms to finish",
        body: alert.summary,
        cooldownHours: 24,
      });
      continue;
    }

    if (alert.type === "orientation_form_revision_needed") {
      specs.push({
        type: "nudge.orientation_revision",
        title: "One of your onboarding forms needs an update",
        body: alert.summary,
        cooldownHours: 24,
      });
      continue;
    }

    if (alert.type === "orientation_item_incomplete") {
      specs.push({
        type: "nudge.orientation_checklist",
        title: "Your orientation checklist still has required items",
        body: alert.summary,
        cooldownHours: 24,
      });
      continue;
    }

    if (alert.type === "orientation_form_pending_review") {
      specs.push({
        type: "nudge.orientation_review",
        title: "One of your onboarding forms is waiting for review",
        body: alert.summary,
        cooldownHours: 24,
      });
      continue;
    }

    if (alert.type === "goal_resource_stale") {
      specs.push({
        type: "nudge.goal_stale",
        title: "One of your goal plan steps needs attention",
        body: alert.summary,
        cooldownHours: 24,
      });
    }
  }

  for (const entry of evidenceEntries) {
    const dueAt = toDate(entry.dueAt);
    if (!dueAt) continue;
    if (["approved", "completed"].includes(entry.evidenceStatus)) continue;
    if (entry.reviewNeeded || entry.evidenceStatus === "submitted") continue;
    if (["completed", "dismissed"].includes(entry.linkStatus)) continue;

    const days = daysUntil(dueAt, now);
    if (days < 0 || days > 2) continue;

    specs.push({
      type: "nudge.goal_due_soon",
      title: days <= 1 ? "A goal plan step is due soon" : "A goal plan deadline is coming up",
      body: `"${entry.title}" is due ${formatDueLabel(dueAt)}.`,
      cooldownHours: 18,
    });
  }

  return dedupeNotificationSpecs(specs);
}

export function buildTeacherInterventionNotifications({
  studentName,
  studentId,
  alerts,
  reviewQueue,
}: {
  studentName: string;
  studentId: string;
  alerts: InterventionAlert[];
  reviewQueue: GoalReviewQueueItem[];
}): InterventionNotificationSpec[] {
  const specs: InterventionNotificationSpec[] = [];

  for (const alert of alerts) {
    if (alert.type === "orientation_form_missing") {
      specs.push({
        type: "teacher_nudge.orientation_missing",
        title: "Student onboarding forms are still missing",
        body: `${studentName} (${studentId}): ${alert.summary}`,
        cooldownHours: 24,
      });
      continue;
    }

    if (alert.type === "orientation_form_pending_review") {
      specs.push({
        type: "teacher_nudge.orientation_review",
        title: "A student has forms waiting for review",
        body: `${studentName} (${studentId}): ${alert.summary}`,
        cooldownHours: 12,
      });
      continue;
    }

    if (alert.type === "orientation_form_revision_needed") {
      specs.push({
        type: "teacher_nudge.orientation_revision",
        title: "A student needs follow-up on returned forms",
        body: `${studentName} (${studentId}): ${alert.summary}`,
        cooldownHours: 24,
      });
      continue;
    }

    if (alert.type === "orientation_item_incomplete") {
      specs.push({
        type: "teacher_nudge.orientation_checklist",
        title: "A student still has required orientation steps open",
        body: `${studentName} (${studentId}): ${alert.summary}`,
        cooldownHours: 24,
      });
    }
  }

  for (const item of reviewQueue) {
    if (item.kind === "goal_review_pending") {
      specs.push({
        type: "teacher_nudge.goal_review",
        title: "Student work is waiting for review",
        body: `${studentName} (${studentId}): ${item.summary}`,
        cooldownHours: 12,
      });
      continue;
    }

    if (item.kind === "goal_resource_stale") {
      specs.push({
        type: "teacher_nudge.goal_stale",
        title: "Assigned goal support is stalled",
        body: `${studentName} (${studentId}): ${item.summary}`,
        cooldownHours: 24,
      });
    }
  }

  return dedupeNotificationSpecs(specs);
}

function dedupeNotificationSpecs(specs: InterventionNotificationSpec[]) {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.type}::${spec.title}::${spec.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function studentInterventionHref(type: string) {
  switch (type) {
    case "nudge.orientation_missing":
    case "nudge.orientation_revision":
    case "nudge.orientation_review":
    case "nudge.orientation_checklist":
      return "/orientation";
    case "nudge.goal_stale":
    case "nudge.goal_due_soon":
      return "/goals";
    default:
      return "/dashboard";
  }
}

export function teacherInterventionHref(type: string, studentRecordId: string) {
  switch (type) {
    case "teacher_nudge.orientation_missing":
    case "teacher_nudge.orientation_review":
    case "teacher_nudge.orientation_revision":
      return `/teacher/students/${studentRecordId}#submitted-forms`;
    case "teacher_nudge.orientation_checklist":
      return `/teacher/students/${studentRecordId}#orientation-review`;
    case "teacher_nudge.goal_review":
      return `/teacher/students/${studentRecordId}#goal-evidence`;
    case "teacher_nudge.goal_stale":
      return `/teacher/students/${studentRecordId}#goal-plans`;
    default:
      return `/teacher/students/${studentRecordId}`;
  }
}

export function teacherDashboardAlertAction(alertType: string, studentRecordId: string): InterventionAction {
  switch (alertType) {
    case "orientation_form_missing":
      return {
        href: `/teacher/students/${studentRecordId}#submitted-forms`,
        label: "Open forms",
      };
    case "orientation_form_pending_review":
      return {
        href: `/teacher/students/${studentRecordId}#submitted-forms`,
        label: "Review forms",
      };
    case "orientation_form_revision_needed":
      return {
        href: `/teacher/students/${studentRecordId}#submitted-forms`,
        label: "Follow up",
      };
    case "orientation_item_incomplete":
      return {
        href: `/teacher/students/${studentRecordId}#orientation-review`,
        label: "Open orientation",
      };
    case "goal_needs_resource":
      return {
        href: `/teacher/students/${studentRecordId}#goal-plans`,
        label: "Assign support",
      };
    case "goal_resource_stale":
      return {
        href: `/teacher/students/${studentRecordId}#goal-plans`,
        label: "Follow up",
      };
    case "goal_review_pending":
      return {
        href: `/teacher/students/${studentRecordId}#goal-evidence`,
        label: "Review evidence",
      };
    case "certification_stalled":
      return {
        href: `/teacher/students/${studentRecordId}#certification-review`,
        label: "Open certification",
      };
    default:
      return {
        href: `/teacher/students/${studentRecordId}`,
        label: "Open student",
      };
  }
}

export function teacherDashboardAlertQuickAction(alertType: string): DashboardQuickAction | null {
  switch (alertType) {
    case "orientation_form_pending_review":
      return {
        kind: "review_forms",
        label: "Quick review",
      };
    case "orientation_form_missing":
    case "orientation_form_revision_needed":
    case "orientation_item_incomplete":
    case "inactive_student":
    case "inactive_student_14":
    case "inactive_student_30":
    case "inactive_student_60":
    case "inactive_student_90":
    case "career_inactive":
    case "certification_stalled":
    case "overdue_task":
    case "missed_appointment":
    case "goal_resource_stale":
      return {
        kind: "create_task",
        label: "Add task",
      };
    case "goal_needs_resource":
      return {
        kind: "assign_support",
        label: "Quick assign",
      };
    default:
      return null;
  }
}

export function teacherDashboardReviewAction(reviewType: string, studentRecordId: string): InterventionAction {
  switch (reviewType) {
    case "goal_needs_resource":
      return {
        href: `/teacher/students/${studentRecordId}#goal-plans`,
        label: "Assign support",
      };
    case "goal_resource_stale":
      return {
        href: `/teacher/students/${studentRecordId}#goal-plans`,
        label: "Follow up",
      };
    case "goal_review_pending":
      return {
        href: `/teacher/students/${studentRecordId}#goal-evidence`,
        label: "Review evidence",
      };
    default:
      return {
        href: `/teacher/students/${studentRecordId}`,
        label: "Open student",
      };
  }
}

export function teacherDashboardReviewQuickAction(reviewType: string): DashboardQuickAction | null {
  switch (reviewType) {
    case "goal_needs_resource":
      return {
        kind: "assign_support",
        label: "Quick assign",
      };
    case "goal_resource_stale":
      return {
        kind: "create_task",
        label: "Add task",
      };
    case "goal_review_pending":
      return {
        kind: "review_forms",
        label: "Quick review",
      };
    default:
      return null;
  }
}
