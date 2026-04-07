import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { checkClassCompliance } from "@/lib/class-requirement-compliance";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { goalCountsTowardPlan } from "@/lib/goals";

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
  if (classId) await assertStaffCanManageClass(session, classId);
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

  // Fetch student identity and goal counts (readiness is fetched via shared function)
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      isActive: true,
      goals: {
        select: {
          id: true,
          level: true,
          status: true,
          pathwayId: true,
          createdAt: true,
        },
      },
    },
    orderBy: { displayName: "asc" },
  });

  // Compute per-student readiness using shared function
  const studentResults: StudentReadiness[] = await Promise.all(
    students.map(async (s) => {
      const readinessData = await fetchStudentReadinessData(s.id);
      const { readiness } = readinessData;

      // Goal counts
      const planningGoals = s.goals.filter((g) => goalCountsTowardPlan(g.status));
      const completedGoals = s.goals.filter((g) => g.status === "completed");
      const confirmedGoals = s.goals.filter((g) => g.status === "confirmed");

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
    }),
  );

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

  // Pathway coverage: how many eligible goals have a pathway assigned?
  const PATHWAY_ELIGIBLE_LEVELS = ["bhag", "long_term", "monthly"];
  const PATHWAY_ELIGIBLE_STATUSES = ["confirmed", "active", "in_progress"];
  let eligibleGoals = 0;
  let goalsWithPathway = 0;
  for (const s of students) {
    for (const g of s.goals) {
      if (PATHWAY_ELIGIBLE_LEVELS.includes(g.level) && PATHWAY_ELIGIBLE_STATUSES.includes(g.status)) {
        eligibleGoals++;
        if (g.pathwayId) goalsWithPathway++;
      }
    }
  }

  // Class requirement compliance (if filtering by class)
  let requirementCompliance = null;
  if (classId) {
    const complianceMap = await checkClassCompliance(classId);
    const complianceEntries = Array.from(complianceMap.values());
    if (complianceEntries.length > 0 && complianceEntries[0].requiredCount > 0) {
      const compliant = complianceEntries.filter((c) => c.compliant).length;
      requirementCompliance = {
        totalStudents: complianceEntries.length,
        compliantStudents: compliant,
        complianceRate: Math.round((compliant / complianceEntries.length) * 100),
        totalRequired: complianceEntries[0].requiredCount,
        averageMet: Math.round(
          complianceEntries.reduce((sum, c) => sum + c.requiredMet, 0) / complianceEntries.length,
        ),
      };
    }
  }

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
      pathwayCoverage: {
        eligibleGoals,
        goalsWithPathway,
        coverageRate: eligibleGoals > 0
          ? Math.round((goalsWithPathway / eligibleGoals) * 100)
          : 100,
      },
      requirementCompliance,
    },
  });
});
