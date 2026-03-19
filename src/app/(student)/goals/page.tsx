import Link from "next/link";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildGoalPlanEntries } from "@/lib/goal-plan";
import { isGoalLevel, isGoalStatus } from "@/lib/goals";
import { serializeGoalPlanEntries, toGoalResourceLinkView } from "@/lib/goal-resource-links";

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const [goals, resourceLinks] = await Promise.all([
    prisma.goal.findMany({
      where: { studentId: session.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.goalResourceLink.findMany({
      where: { studentId: session.id },
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

  const initialGoals = goals.flatMap((goal) => {
    if (!isGoalLevel(goal.level) || !isGoalStatus(goal.status)) {
      return [];
    }

    return [{
      id: goal.id,
      level: goal.level,
      content: goal.content,
      status: goal.status,
      parentId: goal.parentId,
      createdAt: goal.createdAt.toISOString(),
    }];
  });
  const initialGoalPlans = serializeGoalPlanEntries(await buildGoalPlanEntries({
    goals,
    links: resourceLinks
      .map((link) => toGoalResourceLinkView(link))
      .filter((link): link is NonNullable<typeof link> => !!link),
  }));

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Goal map"
        title="My Goals"
        description="Build your goal ladder here, then use Sage whenever you want coaching help refining it."
        actions={(
          <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
            Talk to Sage
          </Link>
        )}
      />
      <GoalsPageClient initialGoals={initialGoals} initialGoalPlans={initialGoalPlans} />
    </div>
  );
}
