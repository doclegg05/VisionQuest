import GoalPlanFocus from "@/components/goals/GoalPlanFocus";
import CoursesHub from "@/components/lms/CoursesHub";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";

export default async function CoursesPage() {
  const session = await getSession();
  if (!session) return null;

  const { goals, goalPlans } = await getStudentGoalPlanData(session.id);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="SPOKES Training Hub"
        title="Learning Platforms"
        description="Access certification prep, academic courses, and career training platforms. Platforms that match your goals are highlighted."
      />
      <GoalPlanFocus
        title="Goal-aligned training plan"
        description="These platforms and certification paths are the strongest matches for the goals you are actively working right now."
        goals={goals}
        goalPlans={goalPlans}
        resourceTypes={["platform", "certification"]}
        emptyMessage="Keep shaping your goals and the system will suggest training platforms and certification paths here."
      />
      <CoursesHub />
    </div>
  );
}
