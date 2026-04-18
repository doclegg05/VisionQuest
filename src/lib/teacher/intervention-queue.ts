import { computeUrgencyScore, type StudentSignals } from "@/lib/intervention-scoring";
import { isGoalStale } from "@/lib/stale-goal-rules";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";

export interface InterventionQueueStudentRecord {
  id: string;
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
    type: string;
    severity: string;
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

export interface InterventionQueueEntry {
  studentId: string;
  name: string;
  email: string | null;
  programType: ProgramType;
  urgencyScore: number;
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
    daysSinceLastGoalReview: lastGoalReviewedAt
      ? daysBetween(lastGoalReviewedAt, now)
      : 9999,
    daysSinceLastLogin: daysBetween(lastActiveAt, now),
    orientationComplete: readiness.state.orientationComplete,
    orientationProgress:
      input.orientationTotalCount > 0
        ? completedOrientationCount / input.orientationTotalCount
        : 1,
    openAlertCount: student.alerts.length,
    highSeverityAlertCount: student.alerts.filter(
      (alert) => alert.severity === "high",
    ).length,
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

  return {
    studentId: student.id,
    name: student.displayName,
    email: student.email,
    programType,
    urgencyScore: computeUrgencyScore(signals),
    signals,
  };
}
