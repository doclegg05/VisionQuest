import {
  GOAL_RESOURCE_TYPE_LABELS,
  GOAL_RESOURCE_LINK_STATUS_LABELS,
  type GoalPlanEntry,
  type GoalResourceType,
} from "@/lib/goal-resource-links";
import {
  GOAL_LEVEL_META,
  goalCountsTowardPlan,
  goalStatusLabel,
} from "@/lib/goals";
import type { StudentGoalPlanGoal } from "@/lib/goal-plan-data";

interface GoalPlanFocusProps {
  title: string;
  description: string;
  goals: StudentGoalPlanGoal[];
  goalPlans: GoalPlanEntry[];
  resourceTypes: GoalResourceType[];
  emptyMessage: string;
}

function formatDueDate(value: string | Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function GoalPlanFocus({
  title,
  description,
  goals,
  goalPlans,
  resourceTypes,
  emptyMessage,
}: GoalPlanFocusProps) {
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const typeSet = new Set(resourceTypes);
  const filteredPlans = goalPlans
    .map((plan) => ({
      ...plan,
      links: plan.links.filter((link) => typeSet.has(link.resourceType)),
      recommendations: plan.recommendations.filter((entry) => typeSet.has(entry.resourceType)),
    }))
    .filter((plan) => {
      const goal = goalById.get(plan.goalId);
      return !!goal && goalCountsTowardPlan(goal.status) && (plan.links.length > 0 || plan.recommendations.length > 0);
    });

  return (
    <section className="surface-section p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Current plan
          </p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
        </div>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          {filteredPlans.length} goal{filteredPlans.length === 1 ? "" : "s"} with support
        </span>
      </div>

      {filteredPlans.length === 0 ? (
        <p className="mt-5 text-sm text-[var(--ink-muted)]">{emptyMessage}</p>
      ) : (
        <div className="mt-5 space-y-4">
          {filteredPlans.map((plan) => {
            const goal = goalById.get(plan.goalId);
            if (!goal) return null;

            const levelMeta = GOAL_LEVEL_META[goal.level];
            return (
              <article
                key={plan.goalId}
                className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-muted)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg">{levelMeta.icon}</span>
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        {levelMeta.label}
                      </span>
                      <span className="rounded-full bg-[var(--surface-raised)]/85 px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                        {goalStatusLabel(goal.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-strong)]">{goal.content}</p>
                  </div>
                </div>

                {plan.links.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                      Assigned now
                    </p>
                    {plan.links.map((link) => {
                      const dueLabel = formatDueDate(link.dueAt);
                      return (
                        <div key={link.id} className="theme-card rounded-xl p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                                  {GOAL_RESOURCE_TYPE_LABELS[link.resourceType]}
                                </span>
                                <p className="text-sm font-semibold text-[var(--ink-strong)]">{link.title}</p>
                              </div>
                              {link.description ? (
                                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{link.description}</p>
                              ) : null}
                              {link.notes ? (
                                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">{link.notes}</p>
                              ) : null}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2.5 py-1 font-semibold text-[var(--accent-secondary)]">
                                  {GOAL_RESOURCE_LINK_STATUS_LABELS[link.status]}
                                </span>
                                {dueLabel ? (
                                  <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[var(--ink-muted)]">
                                    Due {dueLabel}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {link.url ? (
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] transition hover:bg-[var(--surface-raised)]"
                              >
                                Open
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {plan.recommendations.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                      Recommended next
                    </p>
                    {plan.recommendations.map((entry) => (
                      <div
                        key={`${entry.resourceType}:${entry.resourceId}`}
                        className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-raised)] p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                                {GOAL_RESOURCE_TYPE_LABELS[entry.resourceType]}
                              </span>
                              <p className="text-sm font-semibold text-[var(--ink-strong)]">{entry.title}</p>
                            </div>
                            {entry.description ? (
                              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{entry.description}</p>
                            ) : null}
                            <p className="mt-2 text-xs text-[var(--ink-muted)]">{entry.reason}</p>
                          </div>
                          {entry.url ? (
                            <a
                              href={entry.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] transition hover:bg-[var(--surface-raised)]"
                            >
                              View
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
