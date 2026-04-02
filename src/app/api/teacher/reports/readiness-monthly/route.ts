import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { goalCountsTowardPlan } from "@/lib/goals";
import { getCertificationProgress } from "@/lib/certifications";

interface StudentReadiness {
  id: string;
  studentId: string;
  displayName: string;
  isActive: boolean;
  readinessScore: number;
  breakdown: {
    orientation: { score: number; max: number };
    goalPlanning: { score: number; max: number };
    bhagAchieved: { score: number; max: number };
    certifications: { score: number; max: number };
    portfolio: { score: number; max: number };
    consistency: { score: number; max: number };
  };
  goals: {
    total: number;
    active: number;
    completed: number;
    confirmed: number;
  };
}

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId") ?? undefined;
  // This report is a point-in-time snapshot of current student readiness,
  // not a historical report. The month field in the response reflects now.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Get student IDs the teacher manages (respects classroom isolation)
  const studentIds = await listManagedStudentIds(session, {
    classId,
    includeInactiveAccounts: false,
  });

  if (studentIds.length === 0) {
    return NextResponse.json({
      month: currentMonth,
      students: [],
      summary: {
        totalStudents: 0,
        averageReadiness: 0,
        medianReadiness: 0,
        studentsAbove50: 0,
        studentsAbove75: 0,
        totalGoals: 0,
        totalCompleted: 0,
        totalConfirmed: 0,
      },
    });
  }

  // Fetch all student data needed for readiness computation
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      isActive: true,
      progression: { select: { state: true } },
      goals: {
        select: {
          id: true,
          level: true,
          status: true,
          createdAt: true,
        },
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
    },
    orderBy: { displayName: "asc" },
  });

  // Get orientation total and cert templates for readiness computation
  const [orientationTotal, certTemplates] = await Promise.all([
    prisma.orientationItem.count(),
    prisma.certTemplate.findMany({
      where: { certType: "ready-to-work" },
      select: { id: true, required: true, needsFile: true, needsVerify: true },
    }),
  ]);

  const requiredCertCount = certTemplates.filter((t) => t.required).length;

  // Compute per-student readiness
  const studentResults: StudentReadiness[] = students.map((s) => {
    // Parse progression state for streak data
    let longestStreak = 0;
    let portfolioShared = false;
    if (s.progression?.state) {
      try {
        const state = JSON.parse(s.progression.state);
        longestStreak = state.longestStreak || 0;
        portfolioShared = !!state.portfolioShared;
      } catch {
        /* ignore malformed state */
      }
    }

    // Goal counts
    const planningGoals = s.goals.filter((g) => goalCountsTowardPlan(g.status));
    const completedGoals = s.goals.filter((g) => g.status === "completed");
    // "confirmed" = goals with status explicitly set (completed or in_progress with teacher review)
    // In this context, confirmed means goals that count toward the plan
    const confirmedGoals = planningGoals;

    // Completed goal levels for readiness
    const completedGoalLevels: string[] = [];
    for (const g of completedGoals) {
      if (!completedGoalLevels.includes(g.level)) {
        completedGoalLevels.push(g.level);
      }
    }

    // Cert progress
    const cert = s.certifications[0];
    const certDone = cert
      ? getCertificationProgress(certTemplates, cert.requirements).done
      : 0;

    const bhagCompleted = s.goals.some((g) => g.level === "bhag" && g.status === "completed");

    const readiness = computeReadinessScore(
      {
        orientationComplete: s.orientationProgress.length >= orientationTotal && orientationTotal > 0,
        completedGoalLevels,
        bhagCompleted,
        certificationsEarned: certDone,
        portfolioItemCount: s.portfolioItems.length,
        resumeCreated: !!s.resumeData,
        portfolioShared,
        longestStreak,
      },
      requiredCertCount,
    );

    return {
      id: s.id,
      studentId: s.studentId,
      displayName: s.displayName,
      isActive: s.isActive,
      readinessScore: readiness.score,
      breakdown: {
        orientation: { score: readiness.breakdown.orientation.score, max: readiness.breakdown.orientation.max },
        goalPlanning: { score: readiness.breakdown.goalPlanning.score, max: readiness.breakdown.goalPlanning.max },
        bhagAchieved: { score: readiness.breakdown.bhagAchieved.score, max: readiness.breakdown.bhagAchieved.max },
        certifications: { score: readiness.breakdown.certifications.score, max: readiness.breakdown.certifications.max },
        portfolio: { score: readiness.breakdown.portfolio.score, max: readiness.breakdown.portfolio.max },
        consistency: { score: readiness.breakdown.consistency.score, max: readiness.breakdown.consistency.max },
      },
      goals: {
        total: s.goals.length,
        active: planningGoals.length,
        completed: completedGoals.length,
        confirmed: confirmedGoals.length,
      },
    };
  });

  // Summary statistics
  const scores = studentResults.map((s) => s.readinessScore);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const medianReadiness =
    sortedScores.length === 0
      ? 0
      : sortedScores.length % 2 === 1
        ? sortedScores[Math.floor(sortedScores.length / 2)]
        : Math.round(
            (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2,
          );

  const totalGoals = studentResults.reduce((sum, s) => sum + s.goals.total, 0);
  const totalCompleted = studentResults.reduce((sum, s) => sum + s.goals.completed, 0);
  const totalConfirmed = studentResults.reduce((sum, s) => sum + s.goals.confirmed, 0);

  return NextResponse.json({
    month: currentMonth,
    snapshotType: "point-in-time",
    students: studentResults,
    summary: {
      totalStudents: studentResults.length,
      averageReadiness:
        studentResults.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0,
      medianReadiness,
      studentsAbove50: scores.filter((s) => s >= 50).length,
      studentsAbove75: scores.filter((s) => s >= 75).length,
      totalGoals,
      totalCompleted,
      totalConfirmed,
    },
  });
});
