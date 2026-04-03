import { prisma } from "@/lib/db";
import { buildGoalPlanEntries } from "@/lib/goal-plan";
import {
  isGoalLevel,
  isGoalStatus,
  type GoalLevel,
  type GoalStatus,
} from "@/lib/goals";
import {
  serializeGoalPlanEntries,
  toGoalResourceLinkView,
  type GoalPlanEntry,
} from "@/lib/goal-resource-links";

export interface StudentGoalPlanGoal {
  id: string;
  level: GoalLevel;
  content: string;
  status: GoalStatus;
  parentId: string | null;
  pathwayId: string | null;
  createdAt: string;
  pathway: { id: string; label: string; description: string | null; certifications: string[]; platforms: string[]; estimatedWeeks: number } | null;
}

export async function getStudentGoalPlanData(studentId: string): Promise<{
  goals: StudentGoalPlanGoal[];
  goalPlans: GoalPlanEntry[];
}> {
  const [goals, resourceLinks] = await Promise.all([
    prisma.goal.findMany({
      where: { studentId },
      orderBy: { createdAt: "asc" },
      include: {
        pathway: {
          select: {
            id: true,
            label: true,
            description: true,
            certifications: true,
            platforms: true,
            estimatedWeeks: true,
          },
        },
      },
    }),
    prisma.goalResourceLink.findMany({
      where: { studentId },
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
    }),
  ]);

  return {
    goals: goals.flatMap((goal) => {
      if (!isGoalLevel(goal.level) || !isGoalStatus(goal.status)) {
        return [];
      }

      return [{
        id: goal.id,
        level: goal.level,
        content: goal.content,
        status: goal.status,
        parentId: goal.parentId,
        pathwayId: goal.pathwayId,
        createdAt: goal.createdAt.toISOString(),
        pathway: goal.pathway,
      }];
    }),
    goalPlans: serializeGoalPlanEntries(await buildGoalPlanEntries({
      goals,
      links: resourceLinks
        .map((link) => toGoalResourceLinkView(link))
        .filter((link): link is NonNullable<typeof link> => !!link),
    })),
  };
}
