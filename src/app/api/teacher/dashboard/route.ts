import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { syncAlertsForStudents } from "@/lib/advising";
import { prisma } from "@/lib/db";
import { getCertificationProgress } from "@/lib/certifications";
import { computeReadinessScore } from "@/lib/progression/readiness-score";

// GET — class overview: all students with cross-module progress
export const GET = withTeacherAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const showInactive = url.searchParams.get("showInactive") === "true";
  const now = new Date();
  const upcomingWindow = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  const studentWhere = { role: "student" as const, ...(showInactive ? {} : { isActive: true }) };
  const total = await prisma.student.count({ where: studentWhere });
  const allStudentIds = await prisma.student.findMany({
    where: studentWhere,
    select: { id: true },
    orderBy: { displayName: "asc" },
  });

  await syncAlertsForStudents(allStudentIds.map((student) => student.id));

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
        select: { level: true, status: true },
      },
      orientationProgress: {
        where: { completed: true },
        select: { id: true },
      },
      certifications: {
        select: {
          status: true,
          requirements: {
            select: { templateId: true, completed: true, verifiedBy: true, fileId: true },
          },
        },
      },
      portfolioItems: { select: { id: true } },
      resumeData: { select: { id: true } },
      files: { select: { id: true } },
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
    const goalsByLevel: Record<string, number> = {};
    const completedGoalLevels: string[] = [];
    for (const g of s.goals) {
      goalsByLevel[g.level] = (goalsByLevel[g.level] || 0) + 1;
      if (g.status === "completed" && !completedGoalLevels.includes(g.level)) {
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

    return {
      id: s.id,
      studentId: s.studentId,
      displayName: s.displayName,
      createdAt: s.createdAt,
      isActive: s.isActive,
      lastActive: s.conversations[0]?.updatedAt || s.createdAt,
      xp,
      level,
      streak,
      hasBhag,
      goalsCount: s.goals.length,
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

  const [alerts, upcomingAppointments] = await Promise.all([
    prisma.studentAlert.findMany({
      where: { status: "open" },
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        summary: true,
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
    prisma.appointment.findMany({
      where: {
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
  ]);

  return NextResponse.json({
    students: overview,
    alerts,
    upcomingAppointments,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});
