import GoalTree from "../GoalTree";
import GoalSupportPlanner from "../GoalSupportPlanner";
import GoalPathwayAssigner from "../GoalPathwayAssigner";
import {
  GOAL_RESOURCE_TYPE_LABELS,
} from "@/lib/goal-resource-links";
import { apiFetch } from "@/lib/api";
import type {
  GoalEvidenceData,
  ReviewQueueItemData,
  StudentData,
} from "./types";
import { useState } from "react";

const EVIDENCE_STATUS_STYLES: Record<GoalEvidenceData["evidenceStatus"], string> = {
  not_started: "bg-[var(--surface-interactive)] text-[var(--ink-strong)]",
  in_progress: "bg-sky-100 text-sky-700",
  submitted: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  blocked: "bg-rose-100 text-rose-800",
};

const REVIEW_KIND_LABELS: Record<ReviewQueueItemData["kind"], string> = {
  goal_needs_resource: "Needs assignment",
  goal_resource_stale: "Needs follow-up",
  goal_platform_stale: "Needs follow-through",
  goal_review_pending: "Needs review",
};

interface GoalsPlanTabProps {
  data: StudentData;
  dateFormatter: Intl.DateTimeFormat;
  onChanged: () => Promise<void>;
  onGoalAction: (goalId: string, action: { status?: string; content?: string; confirm?: boolean; reviewed?: boolean; pathwayId?: string | null }) => Promise<void>;
}

export default function GoalsPlanTab({
  data,
  dateFormatter,
  onChanged,
  onGoalAction,
}: GoalsPlanTabProps) {
  const {
    goals,
    goalPlans,
    goalEvidence,
    reviewQueue,
    careerDiscovery,
    careerEducationPlan,
    student,
  } = data;

  const [planBusy, setPlanBusy] = useState(false);
  const [planMessage, setPlanMessage] = useState<string | null>(null);

  const evidenceByLinkId = new Map(goalEvidence.map((entry) => [entry.linkId, entry]));
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));

  async function confirmCareerPlan() {
    if (!careerEducationPlan) return;
    setPlanBusy(true);
    setPlanMessage(null);
    try {
      const res = await apiFetch(`/api/teacher/students/${student.id}/career-plan`, {
        method: "PATCH",
        body: JSON.stringify({ confirm: true, reviewed: true }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : "Could not confirm the plan.",
        );
      }
      await onChanged();
      setPlanMessage("Career & Education Plan confirmed.");
    } catch (err) {
      setPlanMessage(err instanceof Error ? err.message : "Could not confirm the plan.");
    } finally {
      setPlanBusy(false);
    }
  }

  const reviewActionForItem = (item: ReviewQueueItemData) => {
    const evidence = item.linkId ? evidenceByLinkId.get(item.linkId) : null;
    if (item.kind === "goal_needs_resource") {
      return { href: "#goal-plans", label: "Assign support" };
    }
    if (evidence?.resourceType === "form") {
      return { href: "#submitted-forms", label: "Review form" };
    }
    if (evidence?.resourceType === "certification") {
      return { href: "#certification-review", label: "Review certification" };
    }
    if (evidence?.resourceType === "career_step") {
      return { href: "#career-progress", label: "Open career progress" };
    }
    return { href: "#goal-evidence", label: "Open evidence" };
  };

  return (
    <div className="space-y-6">
      {/* Career & Education Plan */}
      <div id="career-education-plan" className="theme-card rounded-xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
              Career &amp; Education Plan
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Mission-aligned plan toward a job or post-secondary transfer. Sage proposes; you confirm.
            </p>
          </div>
          {careerEducationPlan && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                careerEducationPlan.status === "confirmed"
                  ? "bg-emerald-100 text-emerald-800"
                  : careerEducationPlan.status === "proposed"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-[var(--surface-interactive)] text-[var(--ink-muted)]"
              }`}
            >
              {careerEducationPlan.status}
            </span>
          )}
        </div>

        {!careerEducationPlan ? (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            No Career &amp; Education Plan yet. Sage drafts one during the career planning stage after discovery.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Terminal outcome
                </dt>
                <dd className="mt-1 text-[var(--ink-strong)]">
                  {careerEducationPlan.terminalOutcome?.replace(/_/g, " ") ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  ECP status
                </dt>
                <dd className="mt-1 text-[var(--ink-strong)]">
                  {careerEducationPlan.ecpStatus.replace(/_/g, " ")}
                </dd>
              </div>
            </dl>
            {careerEducationPlan.summary && (
              <p className="text-sm text-[var(--ink-strong)]">{careerEducationPlan.summary}</p>
            )}
            {careerEducationPlan.targetClusters.length > 0 && (
              <div>
                <span className="text-xs font-medium text-[var(--ink-muted)] uppercase">Clusters</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {careerEducationPlan.targetClusters.map((cluster) => (
                    <span key={cluster} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">
                      {cluster}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {careerEducationPlan.targetIndustries.length > 0 && (
              <div>
                <span className="text-xs font-medium text-[var(--ink-muted)] uppercase">Industries</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {careerEducationPlan.targetIndustries.map((industry) => (
                    <span key={industry} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-2 py-1 rounded-md">
                      {industry}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(careerEducationPlan.status === "proposed" || careerEducationPlan.status === "draft") && (
              <button
                type="button"
                disabled={planBusy}
                onClick={() => void confirmCareerPlan()}
                className="rounded-lg bg-[var(--accent-secondary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {planBusy ? "Confirming…" : "Confirm plan"}
              </button>
            )}
            {planMessage && (
              <p className="text-sm text-[var(--ink-muted)]" role="status">
                {planMessage}
              </p>
            )}
            {careerEducationPlan.confirmedAt && (
              <p className="text-xs text-[var(--ink-muted)]">
                Confirmed {dateFormatter.format(new Date(careerEducationPlan.confirmedAt))}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Goal Evidence & Review */}
      <div id="goal-evidence" className="theme-card rounded-xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Goal Evidence & Review</h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Track which assigned resources have real student activity and what still needs instructor follow-up.
            </p>
          </div>
          <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
            {reviewQueue.length} open review item{reviewQueue.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          {/* Review Queue */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Review queue</p>
            {reviewQueue.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                No goal-linked review items are open right now.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {reviewQueue.map((item) => (
                  <div
                    key={item.key}
                    className={`rounded-lg border p-4 ${
                      item.severity === "high"
                        ? "border-[var(--border-strong)] bg-[var(--urgency-critical-bg)]"
                        : "border-[var(--border-strong)] bg-[var(--urgency-high-bg)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                            {REVIEW_KIND_LABELS[item.kind]}
                          </span>
                          <p className="text-sm font-semibold text-[var(--ink-strong)]">
                            {item.resourceTitle || item.goalTitle}
                          </p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{item.summary}</p>
                        <p className="mt-2 text-xs text-[var(--ink-muted)]">
                          Goal: {item.goalTitle}
                          {item.detectedAt ? ` \u2022 ${dateFormatter.format(new Date(item.detectedAt))}` : ""}
                        </p>
                      </div>
                      <span className={`rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                        item.severity === "high"
                          ? "text-[var(--urgency-critical-text)]"
                          : "text-[var(--urgency-high-text)]"
                      }`}>
                        {item.severity}
                      </span>
                    </div>
                    {item.dueAt ? (
                      <p className="mt-2 text-xs font-medium text-rose-600">
                        Due {dateFormatter.format(new Date(item.dueAt))}
                      </p>
                    ) : null}
                    <a
                      href={reviewActionForItem(item).href}
                      className="mt-3 inline-flex text-xs font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                    >
                      {reviewActionForItem(item).label} {"\u2192"}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Assigned Resource Evidence */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Assigned resource evidence</p>
            {goalPlans.every((plan) => plan.links.length === 0) ? (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                No assigned goal resources yet.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {goalPlans
                  .filter((plan) => plan.links.length > 0)
                  .map((plan) => {
                    const goal = goalById.get(plan.goalId);
                    if (!goal) return null;

                    return (
                      <div key={plan.goalId} className="theme-card-subtle rounded-lg p-4">
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{goal.content}</p>
                        <div className="mt-3 space-y-3">
                          {plan.links.map((link) => {
                            const evidence = evidenceByLinkId.get(link.id);
                            return (
                              <div key={link.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                                        {GOAL_RESOURCE_TYPE_LABELS[link.resourceType]}
                                      </span>
                                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{link.title}</p>
                                    </div>
                                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                                      {evidence?.summary || "No evidence summary available."}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                                      {evidence?.lastObservedAt ? (
                                        <span>
                                          Last update {dateFormatter.format(new Date(evidence.lastObservedAt))}
                                        </span>
                                      ) : null}
                                      {evidence?.dueAt ? (
                                        <span>Due {dateFormatter.format(new Date(evidence.dueAt))}</span>
                                      ) : null}
                                      {link.url ? (
                                        <a
                                          href={link.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                                        >
                                          Open resource
                                        </a>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${EVIDENCE_STATUS_STYLES[evidence?.evidenceStatus || "not_started"]}`}>
                                      {evidence?.evidenceLabel || "Waiting for activity"}
                                    </span>
                                    {evidence?.reviewNeeded ? (
                                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                        Teacher review
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Goals & Support Planner */}
      <div id="goal-plans" className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">Goals ({goals.length})</h3>
        <div className="mb-5">
          <GoalSupportPlanner goals={goals} goalPlans={goalPlans} onChanged={onChanged} />
        </div>
        <GoalTree goals={goals} />

        {goals.filter(g => g.status === "proposed" || g.status === "active" || g.status === "in_progress").length > 0 && (
          <section className="mt-4 theme-card rounded-xl p-5">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Needs Confirmation
            </h4>
            <ul className="space-y-2">
              {goals
                .filter(g => g.status === "proposed" || g.status === "active" || g.status === "in_progress")
                .map(goal => (
                  <li key={goal.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{goal.content}</p>
                      <p className="text-xs text-[var(--ink-muted)]">{goal.level} &middot; {goal.status}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void onGoalAction(goal.id, { confirm: true })}
                        className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => void onGoalAction(goal.id, { reviewed: true })}
                        className="rounded-lg bg-[var(--surface-interactive)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-strong)]"
                      >
                        Mark Reviewed
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>

      {/* Pathway Assignment */}
      <GoalPathwayAssigner
        studentId={data.student.id}
        goals={goals}
        onGoalAction={onGoalAction}
      />

      {/* Career Discovery */}
      <div id="career-discovery" className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Career Discovery
          {careerDiscovery?.status === "complete" && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Complete</span>
          )}
          {careerDiscovery?.status === "in_progress" && (
            <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">In Progress</span>
          )}
        </h3>
        {!careerDiscovery ? (
          <p className="text-sm text-[var(--ink-muted)]">Student has not started career discovery yet.</p>
        ) : (
          <div className="space-y-3">
            {careerDiscovery.sageSummary && (
              <p className="text-sm text-[var(--ink-strong)]">{careerDiscovery.sageSummary}</p>
            )}
            {careerDiscovery.topClusters.length > 0 && (
              <div>
                <span className="text-xs font-medium text-[var(--ink-muted)] uppercase">Top Pathways</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {careerDiscovery.topClusters.map((cluster) => (
                    <span key={cluster} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">
                      {cluster.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(careerDiscovery.interests.length > 0 || careerDiscovery.strengths.length > 0 || careerDiscovery.subjects.length > 0 || careerDiscovery.problems.length > 0 || careerDiscovery.values.length > 0) && (
              <details className="text-sm">
                <summary className="text-xs font-medium text-[var(--ink-muted)] uppercase cursor-pointer">Signals</summary>
                <div className="mt-2 space-y-2">
                  {careerDiscovery.interests.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--ink-muted)]">Interests:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.interests.map((item, i) => (
                          <span key={i} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.strengths.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--ink-muted)]">Strengths:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.strengths.map((item, i) => (
                          <span key={i} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.subjects.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--ink-muted)]">Preferred Subjects:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.subjects.map((item, i) => (
                          <span key={i} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.problems.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--ink-muted)]">Problems They Care About:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.problems.map((item, i) => (
                          <span key={i} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.values.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--ink-muted)]">Values:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.values.map((item, i) => (
                          <span key={i} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.circumstances.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--ink-muted)]">Circumstances:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.circumstances.map((item, i) => (
                          <span key={i} className="text-xs bg-[var(--surface-interactive)] text-[var(--ink-muted)] px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
