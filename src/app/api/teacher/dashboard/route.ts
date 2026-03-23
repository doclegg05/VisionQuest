import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import {
  assertStaffCanManageClass,
  buildManagedStudentWhere,
  listManagedClasses,
  listManagedStudentIds,
} from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { goalCountsTowardPlan } from "@/lib/goals";
import { getCertificationProgress } from "@/lib/certifications";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import {
  ALL_INACTIVITY_ALERT_TYPES,
  getInactivityStageByType,
  getInactivityStageRank,
  normalizeInactivityAlertType,
} from "@/lib/inactivity";

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

// GET — class overview: all students with cross-module progress
export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const showInactive = url.searchParams.get("showInactive") === "true";
  const requestedClassId = url.searchParams.get("classId")?.trim() || "";
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
    },
    orderBy: { displayName: "asc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  // Get orientation total count
  const orientationTotal = await prisma.orientationItem.count();

  // Get required cert templates count
  const certTemplates = await prisma.certTemplate.findMany({
    where: { certType: "ready-to-work" },
    select: {
      id: true,
      required: true,
      needsFile: true,
      needsVerify: true,
    },
  });

  const overview = students.map((s) => {
    // Parse progression state
    let xp = 0;
    let level = 1;
    let streak = 0;
    let longestStreak = 0;
    let platformsVisited: string[] = [];
    let portfolioShared = false;
    if (s.progression?.state) {
      try {
        const state = JSON.parse(s.progression.state);
        xp = state.xp || 0;
        level = state.level || 1;
        streak = state.streaks?.daily?.current || 0;
        longestStreak = state.streaks?.daily?.longest || 0;
        platformsVisited = state.platformsVisited || [];
        portfolioShared = !!state.portfolioShared;
      } catch { /* ignore */ }
    }

    // Goals summary
    const planningGoals = s.goals.filter((goal) => goalCountsTowardPlan(goal.status));
    const goalsByLevel: Record<string, number> = {};
    const completedGoalLevels: string[] = [];
    for (const g of planningGoals) {
      goalsByLevel[g.level] = (goalsByLevel[g.level] || 0) + 1;
      if (!completedGoalLevels.includes(g.level)) {
        completedGoalLevels.push(g.level);
      }
    }
    const hasBhag = !!goalsByLevel["bhag"];

    // Cert progress
    const cert = s.certifications[0];
    const certDone = cert
      ? getCertificationProgress(certTemplates, cert.requirements).done
      : 0;
    const certPendingVerify = cert
      ? cert.requirements.filter((r) => r.completed && !r.verifiedBy).length
      : 0;

    // Readiness score
    const readiness = computeReadinessScore(
      {
        orientationComplete: s.orientationProgress.length >= orientationTotal && orientationTotal > 0,
        completedGoalLevels,
        certificationsEarned: certDone,
        portfolioItemCount: s.portfolioItems.length,
        resumeCreated: !!s.resumeData,
        portfolioShared,
        platformsVisited,
        longestStreak,
        level,
      },
      certTemplates.filter((t) => t.required).length
    );
    const lastActiveAt = latestDate(
      s.createdAt,
      s.conversations[0]?.updatedAt,
      ...s.goals.map((goal) => goal.updatedAt),
      ...s.orientationProgress.map((progress) => progress.completedAt || null),
      ...s.portfolioItems.map((item) => item.updatedAt),
      ...s.files.map((file) => file.uploadedAt),
      s.formSubmissions[0]?.updatedAt,
      s.applications[0]?.updatedAt,
      s.eventRegistrations[0]?.updatedAt,
    ) || s.createdAt;

    return {
      id: s.id,
      studentId: s.studentId,
      displayName: s.displayName,
      createdAt: s.createdAt,
      isActive: s.isActive,
      lastActive: lastActiveAt,
      xp,
      level,
      streak,
      hasBhag,
      goalsCount: planningGoals.length,
      orientationDone: s.orientationProgress.length,
      orientationTotal,
      certStatus: cert?.status || "not_started",
      certDone,
      certTotal: certTemplates.filter((t) => t.required).length,
      certPendingVerify,
      openAlertCount: s.alerts.length,
      nextAppointmentAt: s.appointments[0]?.startsAt ?? null,
      portfolioItems: s.portfolioItems.length,
      hasResume: !!s.resumeData,
      filesCount: s.files.length,
      readinessScore: readiness.score,
    };
  });

  const [alerts, reviewQueue, upcomingAppointments, inactivityAlerts] = await Promise.all([
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
          in: ["goal_needs_resource", "goal_resource_stale", "goal_review_pending"],
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
      ...alert,
      type: normalizedType,
      stageLabel: stage?.label || "Follow-up",
      nextStep: stage?.nextStep || alert.summary,
    };
  });

  const inactivitySummary = inactivityQueue.reduce(
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

  return NextResponse.json({
    classes,
    currentClassId: requestedClassId || null,
    students: overview,
    alerts,
    inactivityQueue,
    inactivitySummary,
    reviewQueue,
    upcomingAppointments,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});
