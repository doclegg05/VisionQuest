import { NextResponse } from "next/server";
import { notFound, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { suggestPathwaysForGoal } from "@/lib/spokes/goal-matcher";

export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string; goalId: string }> },
) => {
  const { id: studentId, goalId } = await params;
  await assertStaffCanManageStudent(session, studentId);

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, studentId },
    select: { id: true, content: true, pathwayId: true },
  });

  if (!goal) throw notFound("Goal not found.");

  const pathways = await prisma.pathway.findMany({
    select: {
      id: true,
      label: true,
      certifications: true,
      platforms: true,
      active: true,
    },
  });

  const suggestions = suggestPathwaysForGoal(goal.content, pathways);

  return NextResponse.json({
    goalId: goal.id,
    currentPathwayId: goal.pathwayId,
    suggestions,
    allPathways: pathways
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, label: p.label })),
  });
});
