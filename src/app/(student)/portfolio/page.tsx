import { getSession } from "@/lib/auth";
import { getStudentNextStep } from "@/lib/progression/student-next-step";
import { PathToEmployment } from "@/components/progression/PathToEmployment";
import PortfolioPage from "@/components/portfolio/PortfolioPage";
import PageIntro from "@/components/ui/PageIntro";

export default async function Portfolio() {
  const session = await getSession();
  if (!session) return null;

  const nextStep = await getStudentNextStep(session.id);

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
      <PageIntro
        eyebrow="Career story"
        title="Portfolio"
        description="Showcase your work, certifications, and build a resume you can share with confidence."
      />
      <PortfolioPage />
    </div>
  );
}
