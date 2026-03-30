import CertTracker from "@/components/certifications/CertTracker";
import CredlyBadges from "@/components/certifications/CredlyBadges";
import GoalPlanFocus from "@/components/goals/GoalPlanFocus";
import { LearningPathway, LearningPathwayEmpty } from "@/components/career/LearningPathway";
import CoursesHub from "@/components/lms/CoursesHub";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";
import { getLearningPathway } from "@/lib/learning-pathway";

export default async function LearningPage() {
  const session = await getSession();
  if (!session) return null;

  const [{ goals, goalPlans }, pathway] = await Promise.all([
    getStudentGoalPlanData(session.id),
    getLearningPathway(session.id),
  ]);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Learning"
        title="Learning"
        description="Keep your goal-aligned platforms, certification progress, and required training work in one place."
      />

      <section id="roadmap" className="mt-6">
        <h2 className="sr-only">Your Learning Roadmap</h2>
        {pathway ? (
          <LearningPathway pathway={pathway} />
        ) : (
          <LearningPathwayEmpty />
        )}
      </section>

      <GoalPlanFocus
        title="Goal-aligned training"
        description="These are the platforms and certification paths that best support the goals you are actively working."
        goals={goals}
        goalPlans={goalPlans}
        resourceTypes={["platform", "certification"]}
        emptyMessage="Confirm your goals and this page will start surfacing the strongest training and certification matches."
      />

      <section id="platforms" className="mt-8">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Training platforms</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Open the learning tools your class uses and focus first on the ones matched to your active goals.
          </p>
        </div>
        <CoursesHub />
      </section>

      <section id="credentials" className="mt-10">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Credentials</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Track badge visibility and required certification steps without switching to a second tab.
          </p>
        </div>
        <CredlyBadges />
        <div className="mt-4">
          <CertTracker />
        </div>
      </section>
    </div>
  );
}
