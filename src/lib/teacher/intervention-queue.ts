import { alertSeverityRank, isUrgentSeverity } from "@/lib/alert-severity";
import { computeUrgencyScore, computeUrgencyReasons, type StudentSignals } from "@/lib/intervention-scoring";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import { isGoalStale } from "@/lib/stale-goal-rules";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
} from "@/lib/intervention-notifications";
import type { DashboardQuickActionKind } from "@/lib/intervention-notifications";

export interface InterventionQueueStudentRecord {
  id: string;
  studentId: string;
  displayName: string;
  email: string | null;
  createdAt: Date;
  progression: { state: string } | null;
  goals: Array<{
    level: string;
    status: string;
    updatedAt: Date;
    lastReviewedAt: Date | null;
    pathwayId: string | null;
  }>;
  orientationProgress: Array<{
    completed: boolean;
    completedAt: Date | null;
  }>;
  alerts: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    summary: string;
    sourceType: string | null;
    sourceId: string | null;
    detectedAt: Date;
  }>;
  assignedTasks: Array<{
    id: string;
  }>;
  conversations: Array<{
    updatedAt: Date;
  }>;
  portfolioItems: Array<{
    updatedAt: Date;
  }>;
  files: Array<{
    uploadedAt: Date;
  }>;
  formSubmissions: Array<{
    updatedAt: Date;
  }>;
  applications: Array<{
    updatedAt: Date;
  }>;
  eventRegistrations: Array<{
    updatedAt: Date;
  }>;
  certifications: Array<{
    status: string;
  }>;
  resumeData: { id: string } | null;
  publicCredentialPage: { isPublic: boolean } | null;
  classEnrollments?: Array<{
    enrolledAt: Date;
    status: string;
    class: { programType: string };
  }>;
}

export interface QueueAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
}

export interface InterventionQueueEntry {
  studentId: string;
  publicStudentId: string;
  name: string;
  email: string | null;
  programType: ProgramType;
  urgencyScore: number;
  /** Plain-language chips explaining the score (Phase 6). */
  urgencyReasons: string[];
  primaryAlert: QueueAlert | null;
  /** Every open alert, most urgent first. openAlerts[0] is primaryAlert. */
  openAlerts: QueueAlert[];
  recommendedAction: {
    kind: DashboardQuickActionKind | null;
    label: string;
    href: string;
  };
  signals: StudentSignals;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function latestDate(...values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

const ALERT_TYPE_PRIORITY: Record<string, number> = {
  // A crisis check-in outranks every other alert type. It is also the only
  // type written as "critical", so severity already puts it first; this entry
  // keeps the order right if a writer ever uses "high" for it.
  [WELLBEING_ALERT_TYPE]: 130,
  goal_missing_confirmed: 110,
  goal_unconfirmed: 108,
  goal_review_pending: 105,
  goal_needs_resource: 100,
  goal_missing_monthly: 95,
  goal_review_stale: 90,
  goal_resource_stale: 85,
  goal_platform_stale: 80,
  goal_stale: 75,
  orientation_verification_pending: 72,
  orientation_form_pending_review: 70,
  overdue_task: 65,
  missed_appointment: 60,
  certification_stalled: 55,
  // Match & Connect Phase 5. A lost placement outranks everything above it:
  // it is the outcome the whole programme is measured on, and it has a
  // reporting deadline. The rest sit around the advising tier — real work,
  // but nothing that stops a grant number being wrong.
  connect_retention_lost: 115,
  connect_retention_unanswered: 92,
  connect_interview_unconfirmed: 88,
  connect_retention_confirm: 68,
  connect_employer_no_response: 63,
  connect_employer_no_view: 58,
};

type QueueAlertRecord = InterventionQueueStudentRecord["alerts"][number];

function serializeQueueAlert(alert: QueueAlertRecord): QueueAlert {
  return { ...alert, detectedAt: alert.detectedAt.toISOString() };
}

/** Most urgent first: severity, then alert-type priority, then newest. */
export function compareQueueAlerts(left: QueueAlertRecord, right: QueueAlertRecord): number {
  const severityGap = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
  if (severityGap !== 0) return severityGap;

  const priorityGap = (ALERT_TYPE_PRIORITY[right.type] ?? 0) - (ALERT_TYPE_PRIORITY[left.type] ?? 0);
  if (priorityGap !== 0) return priorityGap;

  return right.detectedAt.getTime() - left.detectedAt.getTime();
}

function fallbackAction(studentId: string, signals: StudentSignals) {
  if (signals.unmatchedGoalCount > 0) {
    return {
      kind: "assign_support" as const,
      label: "Assign support",
      href: `/teacher/students/${studentId}#goal-plans`,
    };
  }

  if (signals.stalledGoalCount > 0 || (signals.daysSinceLastGoalReview ?? 0) >= 14) {
    return {
      kind: "create_task" as const,
      label: "Add goal review task",
      href: `/teacher/students/${studentId}#goal-plans`,
    };
  }

  if (signals.overdueTaskCount > 0 || signals.daysSinceLastLogin > 7) {
    return {
      kind: "create_task" as const,
      label: "Add task",
      href: `/teacher/students/${studentId}#follow-up-tasks`,
    };
  }

  if (!signals.orientationComplete) {
    return {
      kind: "create_task" as const,
      label: "Add orientation task",
      href: `/teacher/students/${studentId}#orientation-review`,
    };
  }

  return {
    kind: null,
    label: "Open student",
    href: `/teacher/students/${studentId}`,
  };
}

export function buildInterventionQueueEntry(input: {
  student: InterventionQueueStudentRecord;
  now?: Date;
  orientationTotalCount: number;
  totalCertifications?: number;
}): InterventionQueueEntry {
  const now = input.now ?? new Date();
  const { student } = input;

  const lastActiveAt =
    latestDate(
      student.createdAt,
      student.conversations[0]?.updatedAt ?? null,
      ...student.goals.map((goal) => goal.updatedAt),
      ...student.orientationProgress.map((progress) => progress.completedAt ?? null),
      ...student.portfolioItems.map((item) => item.updatedAt),
      ...student.files.map((file) => file.uploadedAt),
      student.formSubmissions[0]?.updatedAt ?? null,
      student.applications[0]?.updatedAt ?? null,
      student.eventRegistrations[0]?.updatedAt ?? null,
    ) ?? student.createdAt;

  const activeGoals = student.goals.filter(
    (goal) => goal.status !== "completed" && goal.status !== "abandoned",
  );
  const lastGoalReviewedAt =
    activeGoals.length > 0
      ? activeGoals.reduce<Date | null>((latest, goal) => {
          const candidate = goal.lastReviewedAt ?? goal.updatedAt;
          if (!latest || candidate.getTime() > latest.getTime()) {
            return candidate;
          }
          return latest;
        }, null)
      : null;

  const completedOrientationCount = student.orientationProgress.filter(
    (progress) => progress.completed,
  ).length;
  const bhagCompleted = student.goals.some(
    (goal) => goal.level === "bhag" && goal.status === "completed",
  );
  const readiness = buildReadinessSnapshot({
    progressionState: student.progression?.state ?? null,
    orientationCompletedCount: completedOrientationCount,
    orientationTotalCount: input.orientationTotalCount,
    bhagCompleted,
    certificationsEarned: student.certifications.filter(
      (certification) => certification.status === "completed",
    ).length,
    portfolioItemCount: student.portfolioItems.length,
    hasResume: Boolean(student.resumeData),
    portfolioShared: Boolean(student.publicCredentialPage?.isPublic),
    totalCertifications: input.totalCertifications,
  });

  // Unmatched goals: confirmed/active goals without pathway assignment
  const PATHWAY_ELIGIBLE_STATUSES = ["confirmed", "active", "in_progress"];
  const PATHWAY_ELIGIBLE_LEVELS = ["bhag", "long_term", "monthly"];
  const unmatchedGoalCount = student.goals.filter(
    (goal) =>
      PATHWAY_ELIGIBLE_STATUSES.includes(goal.status) &&
      PATHWAY_ELIGIBLE_LEVELS.includes(goal.level) &&
      !goal.pathwayId,
  ).length;

  const signals: StudentSignals = {
    daysSinceLastGoalReview: lastGoalReviewedAt ? daysBetween(lastGoalReviewedAt, now) : null,
    daysSinceLastLogin: daysBetween(lastActiveAt, now),
    orientationComplete: readiness.state.orientationComplete,
    orientationProgress:
      input.orientationTotalCount > 0
        ? completedOrientationCount / input.orientationTotalCount
        : 1,
    openAlertCount: student.alerts.length,
    highSeverityAlertCount: student.alerts.filter((alert) => isUrgentSeverity(alert.severity)).length,
    evidenceGapCount: student.alerts.filter(
      (alert) => alert.type === "evidence_gap",
    ).length,
    overdueTaskCount: student.assignedTasks.length,
    stalledGoalCount: student.goals.filter((goal) =>
      isGoalStale(
        {
          level: goal.level,
          status: goal.status,
          updatedAt: goal.updatedAt,
          lastReviewedAt: goal.lastReviewedAt,
        },
        now,
      ),
    ).length,
    unmatchedGoalCount,
    readinessScore: readiness.readiness.score,
  };

  const enrollments = student.classEnrollments ?? [];
  const activeEnrollment =
    enrollments.find((enrollment) => enrollment.status === "active") ?? enrollments[0];
  const programType = normalizeProgramType(activeEnrollment?.class.programType);
  const openAlerts = [...student.alerts].sort(compareQueueAlerts).map(serializeQueueAlert);
  const primaryAlert = openAlerts[0] ?? null;
  const quickAction = primaryAlert ? teacherDashboardAlertQuickAction(primaryAlert.type) : null;
  const alertAction = primaryAlert ? teacherDashboardAlertAction(primaryAlert.type, student.id) : null;
  const fallback = primaryAlert ? null : fallbackAction(student.id, signals);

  return {
    studentId: student.id,
    publicStudentId: student.studentId,
    name: student.displayName,
    email: student.email,
    programType,
    urgencyScore: computeUrgencyScore(signals),
    urgencyReasons: computeUrgencyReasons(signals),
    primaryAlert,
    openAlerts,
    recommendedAction: {
      kind: quickAction?.kind ?? fallback?.kind ?? null,
      label: quickAction?.label ?? alertAction?.label ?? fallback?.label ?? "Open student",
      href: alertAction?.href ?? fallback?.href ?? `/teacher/students/${student.id}`,
    },
    signals,
  };
}

export type UrgencyLevel = "critical" | "high" | "medium";

/** The badge level for a queue row. A crisis alert is critical whatever the score. */
export function urgencyLevel(
  entry: Pick<InterventionQueueEntry, "urgencyScore" | "primaryAlert">,
): UrgencyLevel {
  if (entry.primaryAlert?.severity === "critical" || entry.urgencyScore >= 50) return "critical";
  if (entry.urgencyScore >= 25) return "high";
  return "medium";
}

/**
 * Queue order. A student with an open crisis alert always comes first, then
 * everyone else by urgency score. Score alone cannot do this: a long absence
 * outscores one crisis alert, and a crisis must never sit below the fold.
 */
export function compareQueueEntries(left: InterventionQueueEntry, right: InterventionQueueEntry): number {
  const crisisGap = Number(hasCrisis(right)) - Number(hasCrisis(left));
  if (crisisGap !== 0) return crisisGap;
  return right.urgencyScore - left.urgencyScore;
}

function hasCrisis(entry: InterventionQueueEntry): boolean {
  return entry.primaryAlert?.severity === "critical";
}
