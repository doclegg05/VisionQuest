import { NextResponse } from "next/server";
import { forbidden, isStaffRole, notFound, unauthorized, withErrorHandler } from "@/lib/api-error";
import { getSession } from "@/lib/auth";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { buildGoalPlanEntries } from "@/lib/goal-plan";
import { serializeGoalPlanEntries, toGoalResourceLinkView } from "@/lib/goal-resource-links";

export const GET = withErrorHandler(async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { id } = await params;
  const goal = await prisma.goal.findFirst({
    where: { id },
    select: {
      id: true,
      studentId: true,
      level: true,
      content: true,
      status: true,
      parentId: true,
      createdAt: true,
    },
  });

  if (!goal) {
    throw notFound("Goal not found.");
  }

  if (isStaffRole(session.role)) {
    await assertStaffCanManageStudent(session, goal.studentId);
  } else if (goal.studentId !== session.id) {
    throw forbidden();
  }

  const links = await prisma.goalResourceLink.findMany({
    where: { goalId: goal.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      goalId: true,
      resourceType: true,
      resourceId: true,
      title: true,
      description: true,
      url: true,
      linkType: true,
      status: true,
      dueAt: true,
      notes: true,
      assignedById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const planEntries = serializeGoalPlanEntries(await buildGoalPlanEntries({
    goals: [goal],
    links: links
      .map((link) => toGoalResourceLinkView(link))
      .filter((link): link is NonNullable<typeof link> => !!link),
  }));
  const plan = planEntries[0] ?? { goalId: goal.id, suggestions: [], recommendations: [], links: [] };

  return NextResponse.json({
    goal: {
      id: goal.id,
      level: goal.level,
      content: goal.content,
      status: goal.status,
      parentId: goal.parentId,
      createdAt: goal.createdAt.toISOString(),
    },
    suggestions: plan.suggestions,
    recommendations: plan.recommendations,
    links: plan.links,
  });
});
