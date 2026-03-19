"use client";

import { useState } from "react";
import { GOAL_LEVEL_META, goalStatusLabel, goalCountsTowardPlan } from "@/lib/goals";
import {
  GOAL_RESOURCE_LINK_STATUS_LABELS,
  GOAL_RESOURCE_TYPE_LABELS,
  type GoalPlanEntry,
} from "@/lib/goal-resource-links";

interface GoalData {
  id: string;
  level: string;
  content: string;
  status: string;
}

interface GoalSupportPlannerProps {
  goals: GoalData[];
  goalPlans: GoalPlanEntry[];
  onChanged: () => Promise<void>;
}

const GOAL_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-sky-100 text-sky-700",
  blocked: "bg-amber-100 text-amber-800",
  completed: "bg-violet-100 text-violet-700",
  abandoned: "bg-slate-100 text-slate-600",
};

export default function GoalSupportPlanner({ goals, goalPlans, onChanged }: GoalSupportPlannerProps) {
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const planningGoals = goals.filter((goal) => goalCountsTowardPlan(goal.status));
  if (planningGoals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgba(18,38,63,0.14)] p-5 text-sm text-[var(--ink-muted)]">
        No active goal plans to assign resources to yet.
      </div>
    );
  }

  async function handleAssign(goalId: string, recommendation: GoalPlanEntry["recommendations"][number]) {
    const assignKey = `${goalId}:${recommendation.resourceType}:${recommendation.resourceId}`;
    setAssigningKey(assignKey);
    setMessage(null);

    try {
      const response = await fetch("/api/goal-resource-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId,
          resourceType: recommendation.resourceType,
          resourceId: recommendation.resourceId,
          title: recommendation.title,
          description: recommendation.description,
          url: recommendation.url,
          linkType: "assigned",
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not assign the resource.");
      }

      setMessage({ tone: "success", text: `"${recommendation.title}" assigned to the goal plan.` });
      await onChanged();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not assign the resource.",
      });
    } finally {
      setAssigningKey(null);
    }
  }

  return (
    <div className="space-y-4">
      {message ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50/80 text-emerald-700"
              : "border-rose-200 bg-rose-50/80 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {planningGoals.map((goal) => {
        const plan = goalPlans.find((entry) => entry.goalId === goal.id) ?? {
          goalId: goal.id,
          suggestions: [],
          recommendations: [],
          links: [],
        };
        const meta = GOAL_LEVEL_META[goal.level as keyof typeof GOAL_LEVEL_META];

        return (
          <div key={goal.id} className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg">{meta?.icon || "🎯"}</span>
                  <p className="text-sm font-semibold text-gray-900">
                    {meta?.label || goal.level}
                  </p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${GOAL_STATUS_STYLES[goal.status] || GOAL_STATUS_STYLES.active}`}>
                    {goalStatusLabel(goal.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-700">{goal.content}</p>
              </div>
              <span className="text-xs text-gray-400">
                {plan.links.length} linked
              </span>
            </div>

            {plan.links.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                  Assigned Resources
                </p>
                {plan.links.map((link) => (
                  <div key={link.id} className="rounded-lg border border-[rgba(18,38,63,0.08)] bg-[rgba(16,37,62,0.02)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                            {GOAL_RESOURCE_TYPE_LABELS[link.resourceType]}
                          </span>
                          <p className="text-sm font-semibold text-gray-900">{link.title}</p>
                        </div>
                        {link.description ? (
                          <p className="mt-1 text-sm text-gray-600">{link.description}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                          {GOAL_RESOURCE_LINK_STATUS_LABELS[link.status]}
                        </span>
                        {link.url ? (
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                          >
                            Open
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {plan.recommendations.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                  Recommended Resources
                </p>
                {plan.recommendations.map((recommendation) => {
                  const linkKey = `${recommendation.resourceType}:${recommendation.resourceId}`;
                  const alreadyLinked = plan.links.some((link) => `${link.resourceType}:${link.resourceId}` === linkKey);
                  const assignKey = `${goal.id}:${linkKey}`;

                  return (
                    <div key={linkKey} className="rounded-lg border border-dashed border-[rgba(18,38,63,0.12)] bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                              {GOAL_RESOURCE_TYPE_LABELS[recommendation.resourceType]}
                            </span>
                            <p className="text-sm font-semibold text-gray-900">{recommendation.title}</p>
                          </div>
                          {recommendation.description ? (
                            <p className="mt-1 text-sm text-gray-600">{recommendation.description}</p>
                          ) : null}
                          <p className="mt-2 text-xs text-gray-400">{recommendation.reason}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {recommendation.url ? (
                            <a
                              href={recommendation.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-sky-700 hover:text-sky-900"
                            >
                              View
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleAssign(goal.id, recommendation)}
                            disabled={alreadyLinked || assigningKey === assignKey}
                            className="rounded-full bg-[var(--ink-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {alreadyLinked ? "Assigned" : assigningKey === assignKey ? "Assigning..." : "Assign"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-400">No matched resources yet for this goal.</p>
            )}

            {plan.suggestions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {plan.suggestions.map((suggestion) => (
                  <span
                    key={suggestion}
                    className="rounded-full bg-[rgba(15,154,146,0.1)] px-3 py-1 text-xs text-[var(--accent-secondary)]"
                  >
                    {suggestion}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
