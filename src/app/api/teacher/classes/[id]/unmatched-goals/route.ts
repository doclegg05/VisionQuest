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

  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: {
      classId,
      status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
    },
    select: {
      student: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  const studentIds = enrollments.map((e) => e.student.id);

  if (studentIds.length === 0) {
    return NextResponse.json({ students: [] });
  }

  const unmatchedGoals = await prisma.goal.findMany({
    where: {
      studentId: { in: studentIds },
      status: { in: [...GOAL_PLANNING_STATUSES] },
      pathwayId: null,
      level: { in: [...PATHWAY_REQUIRED_LEVELS] },
    },
    select: {
      id: true,
      studentId: true,
      level: true,
      content: true,
      status: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const goalsByStudentId = new Map<string, typeof unmatchedGoals>();
  for (const goal of unmatchedGoals) {
    const existing = goalsByStudentId.get(goal.studentId) ?? [];
    goalsByStudentId.set(goal.studentId, [...existing, goal]);
  }

  const studentLookup = new Map(
    enrollments.map((e) => [e.student.id, e.student]),
  );

  const students = studentIds
    .filter((id) => goalsByStudentId.has(id))
    .map((id) => {
      const student = studentLookup.get(id)!;
      const goals = goalsByStudentId.get(id)!;
      return {
        id: student.id,
        displayName: student.displayName,
        unmatchedGoals: goals.map((g) => ({
          id: g.id,
          level: g.level,
          content: g.content,
          status: g.status,
        })),
      };
    });

  return NextResponse.json({ students });
});
