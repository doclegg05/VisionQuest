"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api";
import { GOAL_LEVEL_META, goalStatusLabel } from "@/lib/goals";
import {
  GOAL_RESOURCE_TYPE_LABELS,
  type GoalPlanEntry,
} from "@/lib/goal-resource-links";
import type { DashboardQuickActionKind } from "@/lib/intervention-notifications";

interface DashboardActionStudent {
  id: string;
  studentId: string;
  displayName: string;
}

interface GoalData {
  id: string;
  level: string;
  content: string;
  status: string;
}

interface FormSubmissionData {
  id: string;
  formId: string;
  title: string;
  description: string | null;
  status: string;
  updatedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  file: {
    id: string;
    filename: string;
  } | null;
}

interface DashboardActionContext {
  student: DashboardActionStudent;
  goals: GoalData[];
  goalPlans: GoalPlanEntry[];
  formSubmissions: FormSubmissionData[];
}

export interface DashboardActionIntent {
  kind: DashboardQuickActionKind;
  title: string;
  summary: string;
  severity: string;
  student: DashboardActionStudent;
  goalId?: string | null;
  linkId?: string | null;
}

interface DashboardActionPanelProps {
  intent: DashboardActionIntent;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function defaultTaskDueDate() {
  const due = new Date();
  due.setDate(due.getDate() + 2);
  return toDateInputValue(due);
}

function toDueAtPayload(value: string) {
  if (!value) return null;
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function formatDueDate(value: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildTaskDraft(intent: DashboardActionIntent) {
  return {
    title: `Follow up: ${intent.title}`.slice(0, 120),
    description: intent.summary,
    dueAt: defaultTaskDueDate(),
    priority: intent.severity === "high" ? "high" : "normal",
  };
}

function createAssignmentDrafts(goalPlans: GoalPlanEntry[]) {
  return Object.fromEntries(
    goalPlans.flatMap((plan) =>
      plan.recommendations.map((recommendation) => [
        `${plan.goalId}:${recommendation.resourceType}:${recommendation.resourceId}`,
        { dueAt: "", notes: "" },
      ]),
    ),
  ) as Record<string, { dueAt: string; notes: string }>;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function DashboardActionPanel({
  intent,
  onClose,
  onChanged,
}: DashboardActionPanelProps) {
  const [context, setContext] = useState<DashboardActionContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(intent.kind !== "create_task");
  const [contextError, setContextError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reviewingFormId, setReviewingFormId] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState(() => buildTaskDraft(intent));
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, { dueAt: string; notes: string }>>({});

  const loadContext = useCallback(async () => {
    if (intent.kind === "create_task") {
      setLoadingContext(false);
      setContext(null);
      setContextError(null);
      return;
    }

    setLoadingContext(true);
    setContextError(null);
    try {
      const data = await api.get<DashboardActionContext>(`/api/teacher/students/${intent.student.id}`);
      setContext(data);
      setAssignmentDrafts(createAssignmentDrafts(data.goalPlans));
    } catch (error) {
      setContextError(getErrorMessage(error, "Could not load the student action context."));
    } finally {
      setLoadingContext(false);
    }
  }, [intent.kind, intent.student.id]);

  useEffect(() => {
    setMessage(null);
    setTaskForm(buildTaskDraft(intent));
    void loadContext();
  }, [intent, loadContext]);

  const reviewTargetLink = useMemo(() => {
    if (!intent.linkId || !context) return null;
    return context.goalPlans
      .flatMap((plan) => plan.links)
      .find((link) => link.id === intent.linkId) || null;
  }, [context, intent.linkId]);

  const reviewableForms = useMemo(() => {
    if (!context) return [];
    const forms = context.formSubmissions
      .filter((submission) => submission.status === "pending" || submission.status === "rejected")
      .sort((left, right) => {
        const leftPriority = reviewTargetLink?.resourceType === "form" && left.formId === reviewTargetLink.resourceId ? 0 : 1;
        const rightPriority = reviewTargetLink?.resourceType === "form" && right.formId === reviewTargetLink.resourceId ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });
    return forms;
  }, [context, reviewTargetLink]);

  const selectedGoal = useMemo(() => {
    if (!context) return null;

    const resolvedGoalId = intent.goalId
      || (intent.linkId
        ? context.goalPlans.flatMap((plan) => plan.links).find((link) => link.id === intent.linkId)?.goalId
        : null);
    if (!resolvedGoalId) return null;

    const goal = context.goals.find((item) => item.id === resolvedGoalId);
    const plan = context.goalPlans.find((item) => item.goalId === resolvedGoalId);
    if (!goal || !plan) return null;
    return { goal, plan };
  }, [context, intent.goalId, intent.linkId]);

  async function handleReviewForm(submissionId: string, status: "approved" | "rejected") {
    const notes = status === "rejected"
      ? window.prompt("Optional note for the student:", "")
      : "";
    if (status === "rejected" && notes === null) {
      return;
    }

    setReviewingFormId(submissionId);
    setMessage(null);
    try {
      await api.patch(`/api/teacher/students/${intent.student.id}/forms`, {
        submissionId,
        status,
        notes: notes || "",
      });
      setMessage({
        tone: "success",
        text: status === "approved" ? "Form approved." : "Form returned for revision.",
      });
      await Promise.all([loadContext(), onChanged()]);
    } catch (error) {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "Could not update the form review."),
      });
    } finally {
      setReviewingFormId(null);
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTask(true);
    setMessage(null);

    try {
      await api.post(`/api/teacher/students/${intent.student.id}/tasks`, {
        title: taskForm.title,
        description: taskForm.description,
        dueAt: taskForm.dueAt ? new Date(`${taskForm.dueAt}T12:00:00.000Z`).toISOString() : null,
        priority: taskForm.priority,
      });
      setMessage({ tone: "success", text: "Follow-up task created." });
      await onChanged();
      setTaskForm(buildTaskDraft(intent));
    } catch (error) {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "Could not create the follow-up task."),
      });
    } finally {
      setSavingTask(false);
    }
  }

  async function handleAssign(goalId: string, recommendation: GoalPlanEntry["recommendations"][number]) {
    const draftKey = `${goalId}:${recommendation.resourceType}:${recommendation.resourceId}`;
    const draft = assignmentDrafts[draftKey] || { dueAt: "", notes: "" };
    setAssigningKey(draftKey);
    setMessage(null);

    try {
      await api.post("/api/goal-resource-links", {
        goalId,
        resourceType: recommendation.resourceType,
        resourceId: recommendation.resourceId,
        title: recommendation.title,
        description: recommendation.description,
        url: recommendation.url,
        linkType: "assigned",
        dueAt: toDueAtPayload(draft.dueAt),
        notes: draft.notes.trim(),
      });

      setMessage({
        tone: "success",
        text: `"${recommendation.title}" assigned to the goal plan.`,
      });
      await Promise.all([loadContext(), onChanged()]);
    } catch (error) {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "Could not assign the resource."),
      });
    } finally {
      setAssigningKey(null);
    }
  }

  const heading = intent.kind === "review_forms"
    ? "Quick form review"
    : intent.kind === "assign_support"
      ? "Quick goal support assignment"
      : "Create follow-up task";
  const subheading = `${intent.student.displayName} (${intent.student.studentId})`;

  return (
    <div className="surface-section p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-secondary)]">
            Dashboard Action
          </p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">{heading}</h2>
          <p className="mt-2 break-words text-sm text-[var(--ink-muted)]">{subheading}</p>
          <p className="mt-1 break-words text-sm text-[var(--ink-muted)]">{intent.summary}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/teacher/students/${intent.student.id}`}
            className="rounded-full border border-[rgba(18,38,63,0.1)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
          >
            Open student
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[rgba(18,38,63,0.1)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
          >
            Close
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50/80 text-emerald-700"
              : "border-rose-200 bg-rose-50/80 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {loadingContext ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">Loading action context...</p>
      ) : null}

      {contextError ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
          {contextError}
        </div>
      ) : null}

      {!loadingContext && !contextError && intent.kind === "review_forms" ? (
        <div className="mt-5 space-y-3">
          {reviewableForms.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
              No pending or returned forms are available for quick review right now.
            </p>
          ) : (
            reviewableForms.map((submission) => (
              <div key={submission.id} className="rounded-xl border border-[rgba(18,38,63,0.08)] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{submission.title}</p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          submission.status === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {submission.status === "pending" ? "Awaiting review" : "Needs revision"}
                      </span>
                    </div>
                    {submission.description ? (
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{submission.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                      Updated {new Date(submission.updatedAt).toLocaleDateString()}
                    </p>
                    {submission.notes ? (
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">{submission.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {submission.file ? (
                      <a
                        href={`/api/files/download?id=${submission.file.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                      >
                        View file
                      </a>
                    ) : null}
                    {submission.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleReviewForm(submission.id, "approved")}
                          disabled={reviewingFormId === submission.id}
                          className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {reviewingFormId === submission.id ? "Saving..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewForm(submission.id, "rejected")}
                          disabled={reviewingFormId === submission.id}
                          className="rounded-full bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {reviewingFormId === submission.id ? "Saving..." : "Return"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {!loadingContext && !contextError && intent.kind === "assign_support" ? (
        <div className="mt-5">
          {!selectedGoal ? (
            <p className="rounded-xl border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
              The goal tied to this review item could not be loaded. Open the full student workspace to continue.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[rgba(18,38,63,0.08)] bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg">
                    {GOAL_LEVEL_META[selectedGoal.goal.level as keyof typeof GOAL_LEVEL_META]?.icon || "🎯"}
                  </span>
                  <p className="text-sm font-semibold text-[var(--ink-strong)]">
                    {GOAL_LEVEL_META[selectedGoal.goal.level as keyof typeof GOAL_LEVEL_META]?.label || selectedGoal.goal.level}
                  </p>
                  <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-secondary)]">
                    {goalStatusLabel(selectedGoal.goal.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{selectedGoal.goal.content}</p>
              </div>

              {selectedGoal.plan.links.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    Existing support
                  </p>
                  {selectedGoal.plan.links.map((link) => (
                    <div key={link.id} className="rounded-xl border border-[rgba(18,38,63,0.08)] bg-[rgba(16,37,62,0.02)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              {GOAL_RESOURCE_TYPE_LABELS[link.resourceType]}
                            </span>
                            <p className="text-sm font-semibold text-[var(--ink-strong)]">{link.title}</p>
                          </div>
                          {link.description ? (
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">{link.description}</p>
                          ) : null}
                          {formatDueDate(link.dueAt) ? (
                            <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              Due {formatDueDate(link.dueAt)}
                            </p>
                          ) : null}
                          {link.notes ? (
                            <p className="mt-2 text-sm text-[var(--ink-muted)]">{link.notes}</p>
                          ) : null}
                        </div>
                        {link.url ? (
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                          >
                            Open
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedGoal.plan.recommendations.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
                  No matched support recommendations are available for this goal yet.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    Recommended support
                  </p>
                  {selectedGoal.plan.recommendations.map((recommendation) => {
                    const draftKey = `${selectedGoal.goal.id}:${recommendation.resourceType}:${recommendation.resourceId}`;
                    const draft = assignmentDrafts[draftKey] || { dueAt: "", notes: "" };
                    const alreadyLinked = selectedGoal.plan.links.some(
                      (link) =>
                        link.resourceType === recommendation.resourceType
                        && link.resourceId === recommendation.resourceId,
                    );

                    return (
                      <div key={draftKey} className="rounded-xl border border-dashed border-[rgba(18,38,63,0.12)] bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                                {GOAL_RESOURCE_TYPE_LABELS[recommendation.resourceType]}
                              </span>
                              <p className="text-sm font-semibold text-[var(--ink-strong)]">{recommendation.title}</p>
                            </div>
                            {recommendation.description ? (
                              <p className="mt-1 text-sm text-[var(--ink-muted)]">{recommendation.description}</p>
                            ) : null}
                            <p className="mt-2 text-xs text-[var(--ink-muted)]">{recommendation.reason}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {recommendation.url ? (
                              <a
                                href={recommendation.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                              >
                                View
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleAssign(selectedGoal.goal.id, recommendation)}
                              disabled={alreadyLinked || assigningKey === draftKey}
                              className="rounded-full bg-[var(--ink-strong)] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              {alreadyLinked ? "Assigned" : assigningKey === draftKey ? "Assigning..." : "Assign"}
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
                                    [draftKey]: {
                                      ...draft,
                                      dueAt: event.target.value,
                                    },
                                  }))
                                }
                                className="mt-1 w-full rounded-lg border border-[rgba(18,38,63,0.12)] px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-[var(--accent-secondary)]"
                              />
                            </label>

                            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              Instructor note
                              <textarea
                                value={draft.notes}
                                onChange={(event) =>
                                  setAssignmentDrafts((current) => ({
                                    ...current,
                                    [draftKey]: {
                                      ...draft,
                                      notes: event.target.value.slice(0, 1000),
                                    },
                                  }))
                                }
                                rows={2}
                                placeholder="Optional context or checkpoint."
                                className="mt-1 w-full resize-none rounded-lg border border-[rgba(18,38,63,0.12)] px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-[var(--accent-secondary)]"
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {!loadingContext && !contextError && intent.kind === "create_task" ? (
        <form onSubmit={handleCreateTask} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] xl:items-end">
          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Task title
            <input
              type="text"
              value={taskForm.title}
              onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value.slice(0, 120) }))}
              className="mt-1 w-full rounded-lg border border-[rgba(18,38,63,0.12)] px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-[var(--accent-secondary)]"
              required
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Due date
            <input
              type="date"
              value={taskForm.dueAt}
              onChange={(event) => setTaskForm((current) => ({ ...current, dueAt: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[rgba(18,38,63,0.12)] px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-[var(--accent-secondary)]"
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Priority
            <select
              value={taskForm.priority}
              onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[rgba(18,38,63,0.12)] px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-[var(--accent-secondary)]"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={savingTask}
            className="rounded-full bg-[var(--ink-strong)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2 xl:col-span-1 xl:self-end"
          >
            {savingTask ? "Saving..." : "Create task"}
          </button>

          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)] md:col-span-2 xl:col-span-4">
            Task details
            <textarea
              value={taskForm.description}
              onChange={(event) =>
                setTaskForm((current) => ({ ...current, description: event.target.value.slice(0, 1000) }))
              }
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-[rgba(18,38,63,0.12)] px-3 py-2 text-sm font-normal tracking-normal text-[var(--ink-strong)] outline-none focus:border-[var(--accent-secondary)]"
            />
          </label>
        </form>
      ) : null}
    </div>
  );
}
