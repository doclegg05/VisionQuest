import "server-only";

import {
  assertStaffCanManageClass,
  buildManagedStudentWhere,
  listManagedClasses,
  listManagedStudentIds,
} from "@/lib/classroom";
import { getCertificationProgress } from "@/lib/certifications";
import { prisma } from "@/lib/db";
import { type Session } from "@/lib/api-error";
import { goalCountsTowardPlan } from "@/lib/goals";
import {
  ALL_INACTIVITY_ALERT_TYPES,
  getInactivityStageByType,
  getInactivityStageRank,
  normalizeInactivityAlertType,
} from "@/lib/inactivity";
import { checkClassCompliance } from "@/lib/class-requirement-compliance";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";
import { buildInterventionQueueEntry } from "@/lib/teacher/intervention-queue";

export interface QueueStudent {
  studentId: string;
  name: string;
  email: string | null;
  programType: ProgramType;
  urgencyScore: number;
  signals: {
    stalledGoalCount: number;
    highSeverityAlertCount: number;
    evidenceGapCount: number;
    overdueTaskCount: number;
    daysSinceLastLogin: number;
    orientationComplete: boolean;
    orientationProgress: number;
    readinessScore: number;
    openAlertCount: number;
    daysSinceLastGoalReview: number;
    unmatchedGoalCount: number;
  };
}

export interface InterventionQueueResponse {
  queue: QueueStudent[];
}

export interface StudentOverview {
  id: string;
  studentId: string;
  displayName: string;
  programType: ProgramType;
  createdAt: string;
  lastActive: string;
  xp: number;
  level: number;
  streak: number;
  hasBhag: boolean;
  goalsCount: number;
  orientationDone: number;
  orientationTotal: number;
  certStatus: string;
  certDone: number;
  certTotal: number;
  certPendingVerify: number;
  openAlertCount: number;
  nextAppointmentAt: string | null;
  portfolioItems: number;
  hasResume: boolean;
  filesCount: number;
  isActive: boolean;
  readinessScore: number;
  requirementsMet: number;
  requirementsTotal: number;
}

export interface ManagedClassOption {
  id: string;
  name: string;
  code: string;
  status: string;
  programType: ProgramType;
}

export interface DashboardAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

export type ReviewQueueItem = DashboardAlert;

export interface UpcomingAppointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationType: string;
  locationLabel: string | null;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

export interface InactivityQueueItem extends DashboardAlert {
  stageLabel: string;
  nextStep: string;
}

function serializeDashboardAlert<T extends {
  detectedAt: Date;
  student: { id: string; studentId: string; displayName: string };
}>(alert: T): Omit<T, "detectedAt"> & { detectedAt: string } {
  return {
    ...alert,
    detectedAt: alert.detectedAt.toISOString(),
  };
}

export interface InactivitySummary {
  followUp14: number;
  inactive30: number;
  reengage60: number;
  archiveReview90: number;
}

export interface TeacherDashboardPageData {
  classes: ManagedClassOption[];
  currentClassId: string | null;
  students: StudentOverview[];
  alerts: DashboardAlert[];
  inactivityQueue: InactivityQueueItem[];
  inactivitySummary: InactivitySummary;
  reviewQueue: ReviewQueueItem[];
  upcomingAppointments: UpcomingAppointment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function sortInactivityAlerts<T extends { type: string; detectedAt: Date }>(alerts: T[]) {
  return alerts.sort((left, right) => {
    const stageGap = getInactivityStageRank(right.type) - getInactivityStageRank(left.type);
    if (stageGap !== 0) return stageGap;
    return right.detectedAt.getTime() - left.detectedAt.getTime();
  });
}

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

export async function getInterventionQueue(
  session: Session,
  options: { classId?: string } = {},
): Promise<InterventionQueueResponse> {
  const now = new Date();
  const students = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, {
      classId: options.classId,
      includeInactiveAccounts: false,
    }),
    select: {
      id: true,
      displayName: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      progression: { select: { state: true } },
      goals: {
        select: { level: true, status: true, updatedAt: true, lastReviewedAt: true, pathwayId: true },
      },
      orientationProgress: {
        select: { completed: true, completedAt: true },
      },
      alerts: {
        where: { status: "open" },
        select: { type: true, severity: true },
      },
      assignedTasks: {
        where: {
          status: { not: "completed" },
          dueAt: { lt: now },
        },
        select: { id: true },
      },
      conversations: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      portfolioItems: { select: { updatedAt: true } },
      files: { select: { uploadedAt: true } },
      formSubmissions: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      applications: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      eventRegistrations: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      certifications: {
        select: {
          status: true,
        },
      },
      resumeData: { select: { id: true } },
      publicCredentialPage: { select: { isPublic: true } },
      classEnrollments: {
        select: {
          enrolledAt: true,
          status: true,
          class: { select: { programType: true } },
        },
        orderBy: { enrolledAt: "desc" },
      },
    },
  });

  const orientationTotalCount = await prisma.orientationItem.count();
  const queueEntries = students.map((student) =>
    buildInterventionQueueEntry({
      student,
      now,
      orientationTotalCount,
    }),
  );

  return {
    queue: queueEntries
      .filter((entry) => entry.urgencyScore > 0)
      .sort((a, b) => b.urgencyScore - a.urgencyScore),
  };
}

export async function getTeacherDashboardPage(
  session: Session,
  options: {
    page?: number;
    limit?: number;
    showInactive?: boolean;
    classId?: string;
  } = {},
): Promise<TeacherDashboardPageData> {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 100);
  const showInactive = options.showInactive ?? false;
  const requestedClassId = options.classId?.trim() || "";
  const now = new Date();
  const upcomingWindow = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  if (requestedClassId) {
    await assertStaffCanManageClass(session, requestedClassId);
  }

  const [classes, managedStudentIds] = await Promise.all([
    listManagedClasses(session),
    listManagedStudentIds(session, {
      classId: requestedClassId || undefined,
      includeInactiveAccounts: true,
    }),
  ]);

  const studentWhere = buildManagedStudentWhere(session, {
    classId: requestedClassId || undefined,
    includeInactiveAccounts: showInactive,
  });
  const total = await prisma.student.count({ where: studentWhere });

  const students = await prisma.student.findMany({
    where: studentWhere,
    select: {
      id: true,
      studentId: true,
      displayName: true,
      createdAt: true,
      isActive: true,
      progression: { select: { state: true } },
      goals: {
        select: { level: true, status: true, updatedAt: true },
      },
      orientationProgress: {
        where: { completed: true },
        select: { id: true, completedAt: true },
      },
      certifications: {
        select: {
          status: true,
          requirements: {
            select: { templateId: true, completed: true, verifiedBy: true, fileId: true },
          },
        },
      },
      portfolioItems: { select: { id: true, updatedAt: true } },
      resumeData: { select: { id: true } },
      files: { select: { id: true, uploadedAt: true } },
      formSubmissions: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      applications: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      eventRegistrations: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      alerts: {
        where: { status: "open" },
        select: { id: true, severity: true, title: true, detectedAt: true },
      },
      appointments: {
        where: {
          status: "scheduled",
          startsAt: { gte: now },
        },
        select: { id: true, startsAt: true },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
      conversations: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      classEnrollments: {
        select: {
          enrolledAt: true,
          status: true,
          class: { select: { programType: true } },
        },
        orderBy: { enrolledAt: "desc" },
      },
    },
    orderBy: { displayName: "asc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  const [orientationTotal, certTemplates, complianceMap] = await Promise.all([
    prisma.orientationItem.count(),
    prisma.certTemplate.findMany({
      where: { certType: "ready-to-work" },
      select: {
        id: true,
        required: true,
        needsFile: true,
        needsVerify: true,
      },
    }),
    requestedClassId
      ? checkClassCompliance(requestedClassId)
      : Promise.resolve(new Map()),
  ]);

  const overview = students.map((student) => {
    let xp = 0;
    let level = 1;
    let streak = 0;
    let longestStreak = 0;
    let portfolioShared = false;
    if (student.progression?.state) {
      try {
        const state = JSON.parse(student.progression.state);
        xp = state.xp || 0;
        level = state.level || 1;
        streak = state.currentStreak || state.streaks?.daily?.current || 0;
        longestStreak = state.longestStreak || state.streaks?.daily?.longest || 0;
        portfolioShared = !!state.portfolioShared;
      } catch {
        // Ignore malformed progression state and fall back to defaults.
      }
    }

    const planningGoals = student.goals.filter((goal) => goalCountsTowardPlan(goal.status));
    const goalsByLevel: Record<string, number> = {};
    const completedGoalLevels: string[] = [];
    for (const goal of planningGoals) {
      goalsByLevel[goal.level] = (goalsByLevel[goal.level] || 0) + 1;
      if (goal.status === "completed" && !completedGoalLevels.includes(goal.level)) {
        completedGoalLevels.push(goal.level);
      }
    }
    const hasBhag = !!goalsByLevel.bhag;

    const certification = student.certifications[0];
    const certDone = certification
      ? getCertificationProgress(certTemplates, certification.requirements).done
      : 0;
    const certPendingVerify = certification
      ? certification.requirements.filter((requirement) => requirement.completed && !requirement.verifiedBy).length
      : 0;

    const bhagCompleted = student.goals.some(
      (goal) => goal.level === "bhag" && goal.status === "completed",
    );
    const readiness = computeReadinessScore(
      {
        orientationComplete:
          student.orientationProgress.length >= orientationTotal && orientationTotal > 0,
        completedGoalLevels,
        bhagCompleted,
        certificationsEarned: certDone,
        portfolioItemCount: student.portfolioItems.length,
        resumeCreated: !!student.resumeData,
        portfolioShared,
        longestStreak,
      },
      certTemplates.filter((template) => template.required).length,
    );
    const lastActiveAt =
      latestDate(
        student.createdAt,
        student.conversations[0]?.updatedAt,
        ...student.goals.map((goal) => goal.updatedAt),
        ...student.orientationProgress.map((progress) => progress.completedAt || null),
        ...student.portfolioItems.map((item) => item.updatedAt),
        ...student.files.map((file) => file.uploadedAt),
        student.formSubmissions[0]?.updatedAt,
        student.applications[0]?.updatedAt,
        student.eventRegistrations[0]?.updatedAt,
      ) || student.createdAt;

    const activeEnrollment =
      student.classEnrollments.find((enrollment) => enrollment.status === "active") ??
      student.classEnrollments[0];
    const programType = normalizeProgramType(activeEnrollment?.class.programType);

    return {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      programType,
      createdAt: student.createdAt.toISOString(),
      isActive: student.isActive,
      lastActive: lastActiveAt.toISOString(),
      xp,
      level,
      streak,
      hasBhag,
      goalsCount: planningGoals.length,
      orientationDone: student.orientationProgress.length,
      orientationTotal,
      certStatus: certification?.status || "not_started",
      certDone,
      certTotal: certTemplates.filter((template) => template.required).length,
      certPendingVerify,
      openAlertCount: student.alerts.length,
      nextAppointmentAt: student.appointments[0]?.startsAt.toISOString() ?? null,
      portfolioItems: student.portfolioItems.length,
      hasResume: !!student.resumeData,
      filesCount: student.files.length,
      readinessScore: readiness.score,
      requirementsMet: complianceMap.get(student.id)?.requiredMet ?? 0,
      requirementsTotal: complianceMap.get(student.id)?.requiredCount ?? 0,
    };
  });

  const [alerts, reviewQueue, upcomingAppointments, inactivityAlerts] =
    await Promise.all([
      prisma.studentAlert.findMany({
        where: {
          status: "open",
          studentId: { in: managedStudentIds },
          type: { notIn: [...ALL_INACTIVITY_ALERT_TYPES] },
        },
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          summary: true,
          sourceType: true,
          sourceId: true,
          detectedAt: true,
          student: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
            },
          },
        },
        orderBy: { detectedAt: "desc" },
        take: 8,
      }),
      prisma.studentAlert.findMany({
        where: {
          status: "open",
          studentId: { in: managedStudentIds },
          type: {
            in: [
              "goal_needs_resource",
              "goal_resource_stale",
              "goal_review_pending",
              "goal_platform_stale",
            ],
          },
        },
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          summary: true,
          sourceType: true,
          sourceId: true,
          detectedAt: true,
          student: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
        take: 8,
      }),
      prisma.appointment.findMany({
        where: {
          studentId: { in: managedStudentIds },
          status: "scheduled",
          startsAt: {
            gte: now,
            lte: upcomingWindow,
          },
        },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          locationType: true,
          locationLabel: true,
          student: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
            },
          },
        },
        orderBy: { startsAt: "asc" },
        take: 6,
      }),
      prisma.studentAlert.findMany({
        where: {
          status: "open",
          studentId: { in: managedStudentIds },
          type: { in: [...ALL_INACTIVITY_ALERT_TYPES] },
        },
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          summary: true,
          sourceType: true,
          sourceId: true,
          detectedAt: true,
          student: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
            },
          },
        },
        take: 12,
      }),
    ]);

  const inactivityQueue = sortInactivityAlerts(inactivityAlerts).map((alert) => {
    const stage = getInactivityStageByType(alert.type);
    const normalizedType = normalizeInactivityAlertType(alert.type) || alert.type;

    return {
      ...serializeDashboardAlert(alert),
      type: normalizedType,
      stageLabel: stage?.label || "Follow-up",
      nextStep: stage?.nextStep || alert.summary,
    };
  });

  const inactivitySummary = inactivityQueue.reduce<InactivitySummary>(
    (summary, item) => {
      const normalizedType = normalizeInactivityAlertType(item.type);
      if (normalizedType === "inactive_student_14") summary.followUp14 += 1;
      if (normalizedType === "inactive_student_30") summary.inactive30 += 1;
      if (normalizedType === "inactive_student_60") summary.reengage60 += 1;
      if (normalizedType === "inactive_student_90") summary.archiveReview90 += 1;
      return summary;
    },
    {
      followUp14: 0,
      inactive30: 0,
      reengage60: 0,
      archiveReview90: 0,
    },
  );

  const classOptions: ManagedClassOption[] = classes.map((item) => ({
    id: item.id,
    name: item.name,
    code: item.code,
    status: item.status,
    programType: normalizeProgramType(item.programType),
  }));

  return {
    classes: classOptions,
    currentClassId: requestedClassId || null,
    students: overview,
    alerts: alerts.map(serializeDashboardAlert),
    inactivityQueue,
    inactivitySummary,
    reviewQueue: reviewQueue.map(serializeDashboardAlert),
    upcomingAppointments: upcomingAppointments.map((appointment) => ({
      ...appointment,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTeacherHomeData(
  session: Session,
  options: { classId?: string } = {},
) {
  const [overview, queue] = await Promise.all([
    getTeacherDashboardPage(session, { page: 1, limit: 50, classId: options.classId }),
    getInterventionQueue(session, { classId: options.classId }),
  ]);

  return { overview, queue };
}
