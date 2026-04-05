import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageClass, NON_ARCHIVED_ENROLLMENT_STATUSES } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";

const PATHWAY_REQUIRED_LEVELS = ["bhag", "monthly"] as const;

export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: classId } = await params;
  await assertStaffCanManageClass(session, classId);

  const [enrollments, requirementCount] = await Promise.all([
    prisma.studentClassEnrollment.findMany({
      where: {
        classId,
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
      },
      select: {
        student: {
          select: { id: true },
        },
      },
    }),
    prisma.classRequirement.count({ where: { classId } }),
  ]);

  const studentIds = enrollments.map((e) => e.student.id);
  const totalStudents = studentIds.length;

  if (totalStudents === 0) {
    return NextResponse.json({
      ready: requirementCount > 0,
      checks: {
        allStudentsHavePathway: { pass: true, studentsWithout: 0, total: 0 },
        requirementMatrixPublished: { pass: requirementCount > 0, requiredCount: requirementCount },
        unmatchedGoalCount: 0,
      },
    });
  }

  const [confirmedPathwayGoals, unmatchedGoals] = await Promise.all([
    prisma.goal.findMany({
      where: {
        studentId: { in: studentIds },
        status: "confirmed",
        pathwayId: { not: null },
      },
      select: { studentId: true },
      distinct: ["studentId"],
    }),
    prisma.goal.count({
      where: {
        studentId: { in: studentIds },
        status: { in: [...GOAL_PLANNING_STATUSES] },
        pathwayId: null,
        level: { in: [...PATHWAY_REQUIRED_LEVELS] },
      },
    }),
  ]);

  const studentsWithPathwaySet = new Set(confirmedPathwayGoals.map((g) => g.studentId));
  const studentsWithout = totalStudents - studentsWithPathwaySet.size;
  const allStudentsHavePathway = studentsWithout === 0;
  const requirementMatrixPublished = requirementCount > 0;

  return NextResponse.json({
    ready: allStudentsHavePathway && requirementMatrixPublished,
    checks: {
      allStudentsHavePathway: {
        pass: allStudentsHavePathway,
        studentsWithout,
        total: totalStudents,
      },
      requirementMatrixPublished: {
        pass: requirementMatrixPublished,
        requiredCount: requirementCount,
      },
      unmatchedGoalCount: unmatchedGoals,
    },
  });
});
