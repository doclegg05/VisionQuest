import Link from "next/link";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import StudentPathwayPlan from "@/components/goals/StudentPathwayPlan";
import PageIntro from "@/components/ui/PageIntro";
import { MountainProgressLazy } from "@/components/ui/MountainProgressLazy";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const [{ goals: initialGoals, goalPlans: initialGoalPlans }, { state, readiness }] = await Promise.all([
    getStudentGoalPlanData(session.id),
    fetchStudentReadinessData(session.id),
  ]);

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
      <StudentPathwayPlan goals={initialGoals} />
    </div>
  );
}
