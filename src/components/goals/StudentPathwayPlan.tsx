import Link from "next/link";
import type { StudentGoalPlanGoal } from "@/lib/goal-plan-data";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { PLATFORMS } from "@/lib/spokes/platforms";

interface StudentPathwayPlanProps {
  goals: StudentGoalPlanGoal[];
}

const PATHWAY_ELIGIBLE_STATUSES = ["confirmed", "active", "in_progress"];
const PATHWAY_ELIGIBLE_LEVELS = ["bhag", "long_term", "monthly"];

function getCertLabel(id: string): string {
  return CERTIFICATIONS.find((c) => c.id === id)?.shortName ?? id.replace(/-/g, " ");
}

function getPlatformLabel(id: string): string {
  return PLATFORMS.find((p) => p.id === id)?.name ?? id.replace(/-/g, " ");
}

export default function StudentPathwayPlan({ goals }: StudentPathwayPlanProps) {
  const eligibleGoals = goals.filter(
    (g) =>
      PATHWAY_ELIGIBLE_STATUSES.includes(g.status) &&
      PATHWAY_ELIGIBLE_LEVELS.includes(g.level),
  );

  const goalsWithPathway = eligibleGoals.filter((g) => g.pathway);
  const goalsWithoutPathway = eligibleGoals.filter((g) => !g.pathway);

  if (eligibleGoals.length === 0) return null;

  return (
    <section id="pathway-plan" className="mt-8">
      <div className="mb-4">
        <h2 className="font-display text-2xl text-[var(--ink-strong)]">Your plan</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
          Your instructor has matched your goals to approved learning pathways. These are the certifications and platforms that will help you get where you want to go.
        </p>
      </div>

      {goalsWithPathway.length > 0 && (
        <div className="space-y-4">
          {goalsWithPathway.map((goal) => {
            const pw = goal.pathway!;
            return (
              <div
                key={goal.id}
                className="surface-section p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                      {pw.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                      {goal.content}
                    </p>
                    {pw.description && (
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{pw.description}</p>
                    )}
                  </div>
                  {pw.estimatedWeeks > 0 && (
                    <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 shrink-0">
                      ~{pw.estimatedWeeks} week{pw.estimatedWeeks !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {pw.certifications.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-[var(--ink-muted)] uppercase tracking-wider mb-2">
                      Certifications
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {pw.certifications.map((certId) => (
                        <span
                          key={certId}
                          className="rounded-full bg-purple-50 text-purple-700 px-3 py-1 text-xs font-medium"
                        >
                          {getCertLabel(certId)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {pw.platforms.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-[var(--ink-muted)] uppercase tracking-wider mb-2">
                      Platforms
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {pw.platforms.map((platformId) => (
                        <span
                          key={platformId}
                          className="rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-medium"
                        >
                          {getPlatformLabel(platformId)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {goalsWithoutPathway.length > 0 && (
        <div className="mt-4 surface-section p-5 border-l-4 border-l-amber-400">
          <p className="text-sm font-medium text-[var(--ink-strong)]">
            {goalsWithoutPathway.length === 1
              ? "1 goal doesn't have a pathway yet"
              : `${goalsWithoutPathway.length} goals don't have pathways yet`}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Your instructor will review these and assign the right learning pathway. You can also bring them up in your next advising session.
          </p>
          <ul className="mt-3 space-y-1.5">
            {goalsWithoutPathway.map((goal) => (
              <li key={goal.id} className="text-sm text-[var(--ink-muted)] flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                {goal.content}
              </li>
            ))}
          </ul>
          <Link
            href="/chat"
            prefetch={false}
            className="mt-3 inline-flex text-sm font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
          >
            Talk to Sage about your goals →
          </Link>
        </div>
      )}
    </section>
  );
}
