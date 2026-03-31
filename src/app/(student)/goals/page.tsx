import Link from "next/link";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import PageIntro from "@/components/ui/PageIntro";
import { MountainProgressLazy } from "@/components/ui/MountainProgressLazy";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";
import { prisma } from "@/lib/db";
import { parseState, createInitialState } from "@/lib/progression/engine";
import { computeReadinessScore } from "@/lib/progression/readiness-score";

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const [{ goals: initialGoals, goalPlans: initialGoalPlans }, progression, orientationDoneCount, orientationTotalCount, bhagGoal] = await Promise.all([
    getStudentGoalPlanData(session.id),
    prisma.progression.findUnique({ where: { studentId: session.id }, select: { state: true } }),
    prisma.orientationProgress.count({ where: { studentId: session.id, completed: true } }),
    prisma.orientationItem.count(),
    prisma.goal.findFirst({ where: { studentId: session.id, level: "bhag", status: "completed" }, select: { id: true } }),
  ]);

  const state = progression ? parseState(progression.state) : createInitialState();
  const readiness = computeReadinessScore({
    ...state,
    bhagCompleted: !!bhagGoal,
    orientationProgress: { completed: orientationDoneCount, total: orientationTotalCount },
  });

  return (
    <div className="page-shell">
      <div className="surface-section mb-4 overflow-hidden p-0">
        <MountainProgressLazy
          readinessScore={readiness.score}
          readinessBreakdown={readiness.breakdown}
          level={state.level}
        />
      </div>
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
