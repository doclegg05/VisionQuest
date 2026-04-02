import GoalTree from "../GoalTree";
import GoalSupportPlanner from "../GoalSupportPlanner";
import {
  GOAL_RESOURCE_TYPE_LABELS,
  type GoalPlanEntry,
} from "@/lib/goal-resource-links";
import type {
  GoalData,
  GoalEvidenceData,
  ReviewQueueItemData,
  StudentData,
} from "./types";

const EVIDENCE_STATUS_STYLES: Record<GoalEvidenceData["evidenceStatus"], string> = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-700",
  submitted: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  blocked: "bg-rose-100 text-rose-800",
};

const REVIEW_KIND_LABELS: Record<ReviewQueueItemData["kind"], string> = {
  goal_needs_resource: "Needs assignment",
  goal_resource_stale: "Needs follow-up",
  goal_review_pending: "Needs review",
};

interface GoalsPlanTabProps {
  data: StudentData;
  dateFormatter: Intl.DateTimeFormat;
  onChanged: () => Promise<void>;
}

export default function GoalsPlanTab({
  data,
  dateFormatter,
  onChanged,
}: GoalsPlanTabProps) {
  const {
    goals,
    goalPlans,
    goalEvidence,
    reviewQueue,
    careerDiscovery,
  } = data;

  const evidenceByLinkId = new Map(goalEvidence.map((entry) => [entry.linkId, entry]));
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));

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
      {/* Goal Evidence & Review */}
      <div id="goal-evidence" className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Goal Evidence & Review</h3>
            <p className="mt-1 text-sm text-gray-500">
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
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Review queue</p>
            {reviewQueue.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-gray-500">
                No goal-linked review items are open right now.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {reviewQueue.map((item) => (
                  <div
                    key={item.key}
                    className={`rounded-lg border p-4 ${
                      item.severity === "high"
                        ? "border-rose-200 bg-rose-50/70"
                        : "border-amber-200 bg-amber-50/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-600">
                            {REVIEW_KIND_LABELS[item.kind]}
                          </span>
                          <p className="text-sm font-semibold text-gray-900">
                            {item.resourceTitle || item.goalTitle}
                          </p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-600">{item.summary}</p>
                        <p className="mt-2 text-xs text-gray-400">
                          Goal: {item.goalTitle}
                          {item.detectedAt ? ` \u2022 ${dateFormatter.format(new Date(item.detectedAt))}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-700">
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
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Assigned resource evidence</p>
            {goalPlans.every((plan) => plan.links.length === 0) ? (
              <p className="mt-3 rounded-lg border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-gray-500">
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
                      <div key={plan.goalId} className="rounded-lg border border-gray-100 p-4">
                        <p className="text-sm font-semibold text-gray-900">{goal.content}</p>
                        <div className="mt-3 space-y-3">
                          {plan.links.map((link) => {
                            const evidence = evidenceByLinkId.get(link.id);
                            return (
                              <div key={link.id} className="rounded-lg border border-[rgba(18,38,63,0.08)] bg-[rgba(16,37,62,0.02)] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                        {GOAL_RESOURCE_TYPE_LABELS[link.resourceType]}
                                      </span>
                                      <p className="text-sm font-semibold text-gray-900">{link.title}</p>
                                    </div>
                                    <p className="mt-2 text-sm text-gray-600">
                                      {evidence?.summary || "No evidence summary available."}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
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
                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${EVIDENCE_STATUS_STYLES[evidence?.evidenceStatus || "not_started"]}`}>
                                      {evidence?.evidenceLabel || "Waiting for activity"}
                                    </span>
                                    {evidence?.reviewNeeded ? (
                                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
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
      <div id="goal-plans" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Goals ({goals.length})</h3>
        <div className="mb-5">
          <GoalSupportPlanner goals={goals} goalPlans={goalPlans} onChanged={onChanged} />
        </div>
        <GoalTree goals={goals} />
      </div>

      {/* Career Discovery */}
      <div id="career-discovery" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Career Discovery
          {careerDiscovery?.status === "complete" && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Complete</span>
          )}
          {careerDiscovery?.status === "in_progress" && (
            <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">In Progress</span>
          )}
        </h3>
        {!careerDiscovery ? (
          <p className="text-sm text-gray-400">Student has not started career discovery yet.</p>
        ) : (
          <div className="space-y-3">
            {careerDiscovery.sageSummary && (
              <p className="text-sm text-gray-700">{careerDiscovery.sageSummary}</p>
            )}
            {careerDiscovery.topClusters.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">Top Pathways</span>
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
                <summary className="text-xs font-medium text-gray-500 uppercase cursor-pointer">Signals</summary>
                <div className="mt-2 space-y-2">
                  {careerDiscovery.interests.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Interests:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.interests.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.strengths.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Strengths:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.strengths.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.subjects.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Preferred Subjects:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.subjects.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.problems.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Problems They Care About:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.problems.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.values.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Values:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.values.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {careerDiscovery.circumstances.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Circumstances:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {careerDiscovery.circumstances.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
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
