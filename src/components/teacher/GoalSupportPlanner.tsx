"use client";

import { useEffect, useState } from "react";
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
  abandoned: "bg-[var(--surface-interactive)] text-[var(--ink-strong)]",
};

function formatDueDate(value: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toDueAtPayload(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function createLinkDrafts(goalPlans: GoalPlanEntry[]) {
  return Object.fromEntries(
    goalPlans.flatMap((plan) => plan.links.map((link) => [link.id, {
      dueAt: formatDueDate(link.dueAt),
      notes: link.notes || "",
    }])),
  ) as Record<string, { dueAt: string; notes: string }>;
}

export default function GoalSupportPlanner({ goals, goalPlans, onChanged }: GoalSupportPlannerProps) {
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, { dueAt: string; notes: string }>>({});
  const [linkDrafts, setLinkDrafts] = useState(() => createLinkDrafts(goalPlans));

  useEffect(() => {
    setLinkDrafts(createLinkDrafts(goalPlans));
  }, [goalPlans]);

  const planningGoals = goals.filter((goal) => goalCountsTowardPlan(goal.status));
  if (planningGoals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
        No active goal plans to assign resources to yet.
      </div>
    );
  }

  async function handleAssign(goalId: string, recommendation: GoalPlanEntry["recommendations"][number]) {
    const assignKey = `${goalId}:${recommendation.resourceType}:${recommendation.resourceId}`;
    const draft = assignmentDrafts[assignKey] || { dueAt: "", notes: "" };
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
          dueAt: toDueAtPayload(draft.dueAt),
          notes: draft.notes.trim(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not assign the resource.");
      }

      setAssignmentDrafts((current) => {
        const next = { ...current };
        delete next[assignKey];
        return next;
      });
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

  async function handleSaveLink(linkId: string) {
    const draft = linkDrafts[linkId];
    if (!draft) return;

    setSavingLinkId(linkId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goal-resource-links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dueAt: toDueAtPayload(draft.dueAt),
          notes: draft.notes.trim(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update the plan details.");
      }

      setMessage({ tone: "success", text: "Plan details updated." });
      await onChanged();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not update the plan details.",
      });
    } finally {
      setSavingLinkId(null);
    }
  }

  return (
    <div className="space-y-4">
      {message ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50/80 text-emerald-700"
              : "border-rose-200 bg-rose-50/80 text-rose-800"
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
          <div key={goal.id} className="rounded-xl border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg">{meta?.icon || "🎯"}</span>
                  <p className="text-sm font-semibold text-[var(--ink-strong)]">
                    {meta?.label || goal.level}
                  </p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${GOAL_STATUS_STYLES[goal.status] || GOAL_STATUS_STYLES.active}`}>
                    {goalStatusLabel(goal.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-strong)]">{goal.content}</p>
              </div>
              <span className="text-xs text-[var(--ink-faint)]">
                {plan.links.length} linked
              </span>
            </div>

            {plan.links.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  Assigned Resources
                </p>
                {plan.links.map((link) => {
                  const draft = linkDrafts[link.id] || { dueAt: "", notes: "" };
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
                          {link.description ? (
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">{link.description}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--surface-interactive)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-strong)]">
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

                      <div className="mt-3 grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:items-end">
                        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                          Due date
                          <input
                            type="date"
                            value={draft.dueAt}
                            onChange={(event) =>
                              setLinkDrafts((current) => ({
                                ...current,
                                [link.id]: {
                                  ...draft,
                                  dueAt: event.target.value,
                                },
                              }))
                            }
                            className="mt-1 w-full theme-card-subtle rounded-lg px-3 py-2 text-sm font-normal uppercase tracking-normal text-[var(--ink-strong)] outline-none focus:border-sky-300"
                          />
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                          Instructor note
                          <textarea
                            value={draft.notes}
                            onChange={(event) =>
                              setLinkDrafts((current) => ({
                                ...current,
                                [link.id]: {
                                  ...draft,
                                  notes: event.target.value.slice(0, 1000),
                                },
                              }))
                            }
                            rows={2}
                            placeholder="Add context, a checkpoint, or the next expected move."
                            className="mt-1 w-full resize-none theme-card-subtle rounded-lg px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-sky-300"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => handleSaveLink(link.id)}
                          disabled={savingLinkId === link.id}
                          className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingLinkId === link.id ? "Saving..." : "Save details"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {plan.recommendations.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  Recommended Resources
                </p>
                {plan.recommendations.map((recommendation) => {
                  const linkKey = `${recommendation.resourceType}:${recommendation.resourceId}`;
                  const alreadyLinked = plan.links.some((link) => `${link.resourceType}:${link.resourceId}` === linkKey);
                  const assignKey = `${goal.id}:${linkKey}`;
                  const draft = assignmentDrafts[assignKey] || { dueAt: "", notes: "" };

                  return (
                    <div key={linkKey} className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-raised)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              {GOAL_RESOURCE_TYPE_LABELS[recommendation.resourceType]}
                            </span>
                            <p className="text-sm font-semibold text-[var(--ink-strong)]">{recommendation.title}</p>
                          </div>
                          {recommendation.description ? (
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">{recommendation.description}</p>
                          ) : null}
                          <p className="mt-2 text-xs text-[var(--ink-faint)]">{recommendation.reason}</p>
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
                            className="rounded-full bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-green)]/90 disabled:cursor-not-allowed disabled:bg-[var(--border-strong)]"
                          >
                            {alreadyLinked ? "Assigned" : assigningKey === assignKey ? "Assigning..." : "Assign"}
                          </button>
                        </div>
                      </div>

                      {!alreadyLinked ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
                          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                            Due date
                            <input
                              type="date"
                              value={draft.dueAt}
                              onChange={(event) =>
                                setAssignmentDrafts((current) => ({
                                  ...current,
                                  [assignKey]: {
                                    ...draft,
                                    dueAt: event.target.value,
                                  },
                                }))
                              }
                              className="mt-1 w-full theme-card-subtle rounded-lg px-3 py-2 text-sm font-normal uppercase tracking-normal text-[var(--ink-strong)] outline-none focus:border-sky-300"
                            />
                          </label>

                          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                            Instructor note
                            <textarea
                              value={draft.notes}
                              onChange={(event) =>
                                setAssignmentDrafts((current) => ({
                                  ...current,
                                  [assignKey]: {
                                    ...draft,
                                    notes: event.target.value.slice(0, 1000),
                                  },
                                }))
                              }
                              rows={2}
                              placeholder="Optional context or next-step instruction."
                              className="mt-1 w-full resize-none theme-card-subtle rounded-lg px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-sky-300"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--ink-faint)]">No matched resources yet for this goal.</p>
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
