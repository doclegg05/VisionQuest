import GoalPlanFocus from "@/components/goals/GoalPlanFocus";
import ResourceLibrary from "@/components/resources/ResourceLibrary";
import PageIntro from "@/components/ui/PageIntro";
import DocumentBrowser from "@/components/documents/DocumentBrowser";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";

export default async function ResourcesPage() {
  const session = await getSession();
  if (!session) return null;

  const { goals, goalPlans } = await getStudentGoalPlanData(session.id);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Reference library"
        title="Forms & Documents"
        description="Program forms, certification guides, and compliance documents. View, download, or print any document."
      />
      <GoalPlanFocus
        title="Goal-aligned resource plan"
        description="Use these forms, documents, orientation steps, and portfolio actions to move your current goals forward."
        goals={goals}
        goalPlans={goalPlans}
        resourceTypes={["form", "document", "orientation", "portfolio_task"]}
        emptyMessage="Once your goals are in place, matching forms, documents, and next-step resources will show up here."
      />
      <div className="surface-section p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Action forms
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">SPOKES form library</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
              Open the form you need, upload completed versions when required, and keep your paperwork tied to your goals.
            </p>
          </div>
        </div>
        <ResourceLibrary />
      </div>
      <div className="surface-section p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Reference docs
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Document library</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
              Program guides, certification references, and printable documents stay available here for quick lookup.
            </p>
          </div>
        </div>
        <div className="mt-6">
          <DocumentBrowser />
        </div>
      </div>
    </div>
  );
}
