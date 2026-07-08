import Link from "next/link";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import StudentPathwayPlan from "@/components/goals/StudentPathwayPlan";
import PageIntro from "@/components/ui/PageIntro";
import { MountainProgressLazy } from "@/components/ui/MountainProgressLazy";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { getStudentNextStep } from "@/lib/progression/student-next-step";
import { PathToEmployment } from "@/components/progression/PathToEmployment";

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const [{ goals: initialGoals, goalPlans: initialGoalPlans }, { state, readiness }, nextStep] = await Promise.all([
    getStudentGoalPlanData(session.id),
    fetchStudentReadinessData(session.id),
    getStudentNextStep(session.id),
  ]);

  return (
    <div className="page-shell space-y-6">
      <PathToEmployment
        currentStepKey={nextStep.currentStepKey}
        title={nextStep.title}
        description={nextStep.description}
        whyItMatters={nextStep.whyItMatters}
        actionLabel={nextStep.actionLabel}
        actionLink={nextStep.actionLink}
        steps={nextStep.steps}
      />
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
