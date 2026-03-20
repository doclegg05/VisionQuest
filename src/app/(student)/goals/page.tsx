import Link from "next/link";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const { goals: initialGoals, goalPlans: initialGoalPlans } = await getStudentGoalPlanData(session.id);

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
