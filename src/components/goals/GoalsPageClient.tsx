"use client";

import { useState } from "react";
import { useProgression } from "@/components/progression/ProgressionProvider";
import {
  GOAL_LEVEL_META,
  GOAL_LEVELS,
  GOAL_STATUS_LABELS,
  GOAL_STATUSES,
  type GoalLevel,
  type GoalStatus,
} from "@/lib/goals";
import {
  GOAL_RESOURCE_LINK_STATUSES,
  GOAL_RESOURCE_LINK_STATUS_LABELS,
  GOAL_RESOURCE_TYPE_LABELS,
  type GoalPlanEntry,
  type GoalResourceLinkStatus,
} from "@/lib/goal-resource-links";

interface GoalRecord {
  id: string;
  level: GoalLevel;
  content: string;
  status: GoalStatus;
  parentId: string | null;
  createdAt: string;
}

interface GoalsPageClientProps {
  initialGoals: GoalRecord[];
  initialGoalPlans: GoalPlanEntry[];
}

const LEVEL_STYLES: Record<GoalLevel, string> = {
  bhag: "border-amber-300 bg-amber-50/70",
  monthly: "border-sky-300 bg-sky-50/70",
  weekly: "border-emerald-300 bg-emerald-50/70",
  daily: "border-yellow-300 bg-yellow-50/75",
  task: "border-violet-300 bg-violet-50/70",
};

const STATUS_STYLES: Record<GoalStatus, string> = {
  active: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-sky-100 text-sky-700",
  confirmed: "bg-teal-100 text-teal-700",
  blocked: "bg-amber-100 text-amber-800",
  completed: "bg-violet-100 text-violet-700",
  abandoned: "bg-slate-100 text-slate-700",
};
const RESOURCE_STATUS_STYLES: Record<GoalResourceLinkStatus, string> = {
  suggested: "bg-slate-100 text-slate-700",
  assigned: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-700",
  blocked: "bg-rose-100 text-rose-800",
  dismissed: "bg-zinc-100 text-zinc-600",
};
const STUDENT_LINK_STATUSES: GoalResourceLinkStatus[] = ["assigned", "in_progress", "completed", "blocked"];

function createDraftLookup(goals: GoalRecord[]) {
  return Object.fromEntries(
    goals.map((goal) => [
      goal.id,
      {
        content: goal.content,
        status: goal.status,
      },
    ]),
  ) as Record<string, { content: string; status: GoalStatus }>;
}

function createLinkStatusLookup(goalPlans: GoalPlanEntry[]) {
  return Object.fromEntries(
    goalPlans.flatMap((plan) => plan.links.map((link) => [link.id, link.status])),
  ) as Record<string, GoalResourceLinkStatus>;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDueDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function resourceStatusOptions(currentStatus: GoalResourceLinkStatus): GoalResourceLinkStatus[] {
  return [...new Set([...STUDENT_LINK_STATUSES, currentStatus])];
}

export default function GoalsPageClient({ initialGoals, initialGoalPlans }: GoalsPageClientProps) {
  const { checkProgression } = useProgression();
  const [goals, setGoals] = useState(initialGoals);
  const [goalPlans, setGoalPlans] = useState(initialGoalPlans);
  const [drafts, setDrafts] = useState(() => createDraftLookup(initialGoals));
  const [linkStatusDrafts, setLinkStatusDrafts] = useState(() => createLinkStatusLookup(initialGoalPlans));
  const [createLevel, setCreateLevel] = useState<GoalLevel | null>(null);
  const [newGoalContent, setNewGoalContent] = useState("");
  const [newGoalStatus, setNewGoalStatus] = useState<GoalStatus>("active");
  const [savingGoalId, setSavingGoalId] = useState<string | null>(null);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function upsertGoalPlan(nextPlan: GoalPlanEntry) {
    setGoalPlans((current) => {
      const existingIndex = current.findIndex((plan) => plan.goalId === nextPlan.goalId);
      if (existingIndex === -1) {
        return [...current, nextPlan];
      }

      const updated = [...current];
      updated[existingIndex] = nextPlan;
      return updated;
    });
    setLinkStatusDrafts((current) => {
      const next = { ...current };
      for (const link of nextPlan.links) {
        next[link.id] = link.status;
      }
      return next;
    });
  }

  async function refreshGoalPlan(goalId: string) {
    const response = await fetch(`/api/goals/${goalId}/resources`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Could not load the updated goal plan.");
    }

    upsertGoalPlan({
      goalId,
      suggestions: payload?.suggestions || [],
      recommendations: payload?.recommendations || [],
      links: payload?.links || [],
    });
  }

  async function handleSaveGoal(goalId: string) {
    const goal = goals.find((item) => item.id === goalId);
    const draft = drafts[goalId];
    if (!goal || !draft) return;

    const nextContent = draft.content.trim();
    if (!nextContent) {
      setMessage({ tone: "error", text: "Goal content cannot be empty." });
      return;
    }

    setSavingGoalId(goalId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: nextContent,
          status: draft.status,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.goal) {
        throw new Error(payload?.error || "Could not save the goal.");
      }

      const updatedGoal = payload.goal as GoalRecord;
      setGoals((current) =>
        current.map((item) => (item.id === goalId ? updatedGoal : item)),
      );
      setDrafts((current) => ({
        ...current,
        [goalId]: {
          content: updatedGoal.content,
          status: updatedGoal.status,
        },
      }));
      await refreshGoalPlan(updatedGoal.id);
      setMessage({ tone: "success", text: "Goal updated." });
      await checkProgression();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save the goal.",
      });
    } finally {
      setSavingGoalId(null);
    }
  }

  async function handleCreateGoal(level: GoalLevel) {
    const content = newGoalContent.trim();
    if (!content) {
      setMessage({ tone: "error", text: "Goal content is required." });
      return;
    }

    setCreatingGoal(true);
    setMessage(null);

    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          content,
          status: newGoalStatus,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.goal) {
        throw new Error(payload?.error || "Could not create the goal.");
      }

      const createdGoal = payload.goal as GoalRecord;
      setGoals((current) => [...current, createdGoal]);
      setDrafts((current) => ({
        ...current,
        [createdGoal.id]: {
          content: createdGoal.content,
          status: createdGoal.status,
        },
      }));
      await refreshGoalPlan(createdGoal.id);
      setCreateLevel(null);
      setNewGoalContent("");
      setNewGoalStatus("active");
      setMessage({ tone: "success", text: "Goal added to your plan." });
      await checkProgression();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not create the goal.",
      });
    } finally {
      setCreatingGoal(false);
    }
  }

  async function handleSaveLinkStatus(goalId: string, linkId: string) {
    const nextStatus = linkStatusDrafts[linkId];
    if (!nextStatus) return;

    setSavingLinkId(linkId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goal-resource-links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update the resource status.");
      }

      await refreshGoalPlan(goalId);
      setMessage({ tone: "success", text: "Resource status updated." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not update the resource status.",
      });
    } finally {
      setSavingLinkId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="surface-section p-5">
        <p className="text-sm leading-6 text-[var(--ink-muted)]">
          Build goals directly here, then use Sage when you want coaching help refining them into
          clearer next steps. Status changes stay visible to your instructor and keep your planning
          data aligned with the dashboard.
        </p>
      </div>

      {message ? (
        <div
          className={`surface-section p-4 text-sm ${
            message.tone === "success"
              ? "border border-emerald-200 bg-emerald-50/80 text-emerald-700"
              : "border border-rose-200 bg-rose-50/80 text-rose-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {GOAL_LEVELS.map((level) => {
        const meta = GOAL_LEVEL_META[level];
        const levelGoals = goals.filter((goal) => goal.level === level);

        return (
          <section
            key={level}
            className={`surface-section border-2 p-5 ${LEVEL_STYLES[level]}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{meta.icon}</span>
                  <h2 className="font-display text-xl text-[var(--ink-strong)]">{meta.label}</h2>
                  <span className="rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                    {levelGoals.length}
                  </span>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
                  {level === "bhag"
                    ? "Name the bigger outcome you care about most."
                    : level === "monthly"
                      ? "Turn the big vision into progress you can make this month."
                      : level === "weekly"
                        ? "Choose the moves that matter this week."
                        : level === "daily"
                          ? "Define what today’s momentum should look like."
                          : "Break the daily work into finishable actions."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setCreateLevel(level);
                  setNewGoalContent("");
                  setNewGoalStatus("active");
                  setMessage(null);
                }}
                className="rounded-full border border-[var(--border-strong)] bg-white/80 px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] transition hover:-translate-y-0.5 hover:bg-white"
              >
                Add {level === "task" ? "Task" : "Goal"}
              </button>
            </div>

            {createLevel === level ? (
              <div className="mt-4 rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-sm">
                <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  New {level === "task" ? "Task" : "Goal"}
                </label>
                <textarea
                  value={newGoalContent}
                  onChange={(event) => setNewGoalContent(event.target.value.slice(0, 500))}
                  rows={3}
                  placeholder={`Write your ${meta.label.toLowerCase()} here...`}
                  className="textarea-field mt-2 resize-none px-4 py-3 text-sm"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="text-sm text-[var(--ink-muted)]">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                      Status
                    </span>
                    <select
                      value={newGoalStatus}
                      onChange={(event) => setNewGoalStatus(event.target.value as GoalStatus)}
                      className="select-field min-w-[12rem] px-4 py-2.5 text-sm"
                    >
                      {GOAL_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {GOAL_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCreateGoal(level)}
                      disabled={creatingGoal || !newGoalContent.trim()}
                      className="primary-button px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {creatingGoal ? "Saving..." : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateLevel(null);
                        setNewGoalContent("");
                        setNewGoalStatus("active");
                      }}
                      className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-white/70"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {levelGoals.length > 0 ? (
              <div className="mt-4 space-y-3">
                {levelGoals.map((goal) => {
                  const draft = drafts[goal.id] ?? { content: goal.content, status: goal.status };
                  const goalPlan = goalPlans.find((plan) => plan.goalId === goal.id) ?? {
                    goalId: goal.id,
                    suggestions: [],
                    recommendations: [],
                    links: [],
                  };
                  return (
                    <article
                      key={goal.id}
                      className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[draft.status]}`}
                        >
                          {GOAL_STATUS_LABELS[draft.status]}
                        </span>
                        <span className="text-xs text-[var(--ink-muted)]">
                          Added {formatCreatedAt(goal.createdAt)}
                        </span>
                      </div>

                      <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                        Goal
                      </label>
                      <textarea
                        value={draft.content}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [goal.id]: {
                              ...draft,
                              content: event.target.value.slice(0, 500),
                            },
                          }))
                        }
                        rows={3}
                        className="textarea-field mt-2 resize-none px-4 py-3 text-sm"
                      />

                      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                        <label className="text-sm text-[var(--ink-muted)]">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                            Status
                          </span>
                          <select
                            value={draft.status}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [goal.id]: {
                                  ...draft,
                                  status: event.target.value as GoalStatus,
                                },
                              }))
                            }
                            className="select-field min-w-[12rem] px-4 py-2.5 text-sm"
                          >
                            {GOAL_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {GOAL_STATUS_LABELS[status]}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          type="button"
                          onClick={() => handleSaveGoal(goal.id)}
                          disabled={savingGoalId === goal.id || !draft.content.trim()}
                          className="primary-button px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingGoalId === goal.id ? "Saving..." : "Save Changes"}
                        </button>
                      </div>

                      {goalPlan.links.length > 0 ? (
                        <div className="mt-5 rounded-[1.15rem] border border-[rgba(16,37,62,0.08)] bg-[rgba(16,37,62,0.03)] p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                              Current Plan
                            </p>
                            <span className="text-xs text-[var(--ink-muted)]">
                              {goalPlan.links.length} linked resource{goalPlan.links.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="mt-3 space-y-3">
                            {goalPlan.links.map((link) => {
                              const dueLabel = typeof link.dueAt === "string" ? formatDueDate(link.dueAt) : null;
                              const draftStatus = linkStatusDrafts[link.id] ?? link.status;
                              return (
                                <div key={link.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
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
                                        <span className={`rounded-full px-2.5 py-1 font-semibold ${RESOURCE_STATUS_STYLES[link.status]}`}>
                                          {GOAL_RESOURCE_LINK_STATUS_LABELS[link.status]}
                                        </span>
                                        {dueLabel ? (
                                          <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2.5 py-1 text-[var(--ink-muted)]">
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
                                        className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] transition hover:bg-white"
                                      >
                                        Open Resource
                                      </a>
                                    ) : null}
                                  </div>

                                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                                    <label className="text-sm text-[var(--ink-muted)]">
                                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                                        Progress
                                      </span>
                                      <select
                                        value={draftStatus}
                                        onChange={(event) =>
                                          setLinkStatusDrafts((current) => ({
                                            ...current,
                                            [link.id]: event.target.value as GoalResourceLinkStatus,
                                          }))
                                        }
                                        className="select-field min-w-[12rem] px-4 py-2.5 text-sm"
                                      >
                                        {resourceStatusOptions(link.status).map((status) => (
                                          <option key={status} value={status}>
                                            {GOAL_RESOURCE_LINK_STATUS_LABELS[status]}
                                          </option>
                                        ))}
                                      </select>
                                    </label>

                                    <button
                                      type="button"
                                      onClick={() => handleSaveLinkStatus(goal.id, link.id)}
                                      disabled={savingLinkId === link.id || !GOAL_RESOURCE_LINK_STATUSES.includes(draftStatus)}
                                      className="primary-button px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {savingLinkId === link.id ? "Saving..." : "Update Resource"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {goalPlan.recommendations.length > 0 ? (
                        <div className="mt-5 rounded-[1.15rem] border border-dashed border-[rgba(16,37,62,0.12)] bg-[var(--surface-raised)] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                            Suggested Resources
                          </p>
                          <div className="mt-3 space-y-3">
                            {goalPlan.recommendations.map((resource) => (
                              <div key={`${resource.resourceType}:${resource.resourceId}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                                        {GOAL_RESOURCE_TYPE_LABELS[resource.resourceType]}
                                      </span>
                                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{resource.title}</p>
                                    </div>
                                    {resource.description ? (
                                      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{resource.description}</p>
                                    ) : null}
                                    <p className="mt-2 text-xs text-[var(--ink-muted)]">{resource.reason}</p>
                                  </div>

                                  {resource.url ? (
                                    <a
                                      href={resource.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] transition hover:bg-white"
                                    >
                                      View Resource
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {goalPlan.suggestions.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {goalPlan.suggestions.map((suggestion) => (
                            <span
                              key={suggestion}
                              className="rounded-full bg-[rgba(15,154,146,0.1)] px-3 py-1.5 text-xs text-[var(--accent-secondary)]"
                            >
                              {suggestion}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : createLevel !== level ? (
              <p className="mt-4 text-sm italic text-[var(--ink-muted)]">
                No {level === "task" ? "tasks" : "goals"} here yet. Add one directly or shape it
                with Sage when you want coaching help.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
