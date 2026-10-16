"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiFetch } from "@/lib/api";
import { FormDialog } from "@/components/ui/FormDialog";
import type { InterventionQueueEntry } from "@/lib/teacher/intervention-queue";
import {
  buildQueueSageMessage,
  countInactivityStages,
  groupQueueIssues,
  QUEUE_ROWS_SHOWN,
  queueBodyView,
  visibleQueueRows,
  withPinnedRow,
  type QueueIssueGroup,
} from "@/lib/teacher/queue-issue-groups";
import DashboardActionPanel, { type DashboardActionIntent } from "./DashboardActionPanel";
import { buildAlertActionIntent, mainActionMode } from "./queue-actions";
import { QueueStudentRow } from "./QueueStudentRow";
import type { QueueAlertAction } from "./QueueRowIssues";
import type { InterventionQueueResponse as QueueResponse } from "@/lib/teacher/dashboard";

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function QueueSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading intervention queue">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-[1.15rem] bg-[var(--border)] opacity-60"
        />
      ))}
    </div>
  );
}

// ─── Note Categories ──────────────────────────────────────────────────────────

const NOTE_CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "check_in", label: "Check-in" },
  { value: "risk", label: "Risk" },
  { value: "career", label: "Career" },
  { value: "celebration", label: "Celebration" },
] as const;

// ─── Quick Task Modal ─────────────────────────────────────────────────────────

export function QuickTaskModal({
  studentId,
  studentName,
  onClose,
  onCreated,
}: {
  studentId: string;
  studentName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/teacher/students/${studentId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          dueAt: dueAt || undefined,
          priority: "normal",
        }),
      });

      if (res.ok) {
        onCreated();
        onClose();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create task.");
      }
    } catch {
      setError("Failed to create task.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = title !== "" || dueAt !== "";

  return (
    <FormDialog title={`Quick task for ${studentName}`} dirty={dirty} onClose={onClose} widthClass="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-[var(--ink-strong)]">What needs to be done?</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-[var(--ink-strong)]">Due date (optional)</span>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
        </label>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-[var(--ink-muted)] px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="primary-button pointer-coarse:min-h-11 text-sm px-4 py-1.5 rounded-lg disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Task"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

// ─── Quick Note Modal ─────────────────────────────────────────────────────────

export function QuickNoteModal({
  studentId,
  studentName,
  onClose,
  onCreated,
}: {
  studentId: string;
  studentName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/teacher/students/${studentId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), category }),
      });

      if (res.ok) {
        onCreated();
        onClose();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to save note.");
      }
    } catch {
      setError("Failed to save note.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = body !== "" || category !== "general";

  return (
    <FormDialog title={`Quick note for ${studentName}`} dirty={dirty} onClose={onClose} widthClass="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        {/* Note comes first: showModal() focuses the dialog's first focusable
            field, and React's autoFocus cannot reach a field inside a dialog
            that is still closed at commit time. */}
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-[var(--ink-strong)]">Note</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
            rows={3}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] resize-none"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-[var(--ink-strong)]">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          >
            {NOTE_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-[var(--ink-muted)] px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            className="primary-button pointer-coarse:min-h-11 text-sm px-4 py-1.5 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Note"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

// ─── Quick Appointment Modal ──────────────────────────────────────────────────

export function QuickAppointmentModal({
  studentId,
  studentName,
  onClose,
  onCreated,
}: {
  studentId: string;
  studentName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startsAt) return;

    setSaving(true);
    setError(null);

    const startDate = new Date(startsAt);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

    try {
      const res = await apiFetch(`/api/teacher/students/${studentId}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startsAt: startDate.toISOString(),
          endsAt: endDate.toISOString(),
        }),
      });

      if (res.ok) {
        onCreated();
        onClose();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to schedule appointment.");
      }
    } catch {
      setError("Failed to schedule appointment.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = title !== "" || startsAt !== "";

  return (
    <FormDialog
      title={`Schedule appointment with ${studentName}`}
      dirty={dirty}
      onClose={onClose}
      widthClass="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-[var(--ink-muted)]">Duration defaults to 30 minutes.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-[var(--ink-strong)]">Appointment title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-[var(--ink-strong)]">Date and time</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
        </label>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-[var(--ink-muted)] px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || !startsAt}
            className="primary-button pointer-coarse:min-h-11 text-sm px-4 py-1.5 rounded-lg disabled:opacity-50"
          >
            {saving ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

// ─── Queue ────────────────────────────────────────────────────────────────────

/** Opens Sage without loading the chat bundle until a teacher asks for it. */
function askSage(message: string) {
  void import("@/components/chat/SageMiniChat").then(({ openSageWithMessage }) => openSageWithMessage(message));
}

/** The action panel, opened under the row it belongs to, with focus moved into it. */
function InlineActionPanel({
  intent,
  onClose,
  onChanged,
}: {
  intent: DashboardActionIntent;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label={`Action for ${intent.student.displayName}`}
      className="mt-3 rounded-[1rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
    >
      <DashboardActionPanel intent={intent} onClose={onClose} onChanged={onChanged} />
    </div>
  );
}

type StudentTarget = { studentId: string; name: string };

function targetOf(student: InterventionQueueEntry): StudentTarget {
  return { studentId: student.studentId, name: student.name };
}

export default function InterventionQueuePanel({
  initialQueue,
}: {
  initialQueue?: InterventionQueueEntry[];
}) {
  const [queue, setQueue] = useState<InterventionQueueEntry[]>(initialQueue ?? []);
  const [loading, setLoading] = useState(initialQueue === undefined);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [now] = useState(() => Date.now());
  const [taskTarget, setTaskTarget] = useState<StudentTarget | null>(null);
  const [noteTarget, setNoteTarget] = useState<StudentTarget | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<StudentTarget | null>(null);
  const [actionIntent, setActionIntent] = useState<DashboardActionIntent | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const classId = searchParams.get("classId")?.trim() || "";

  const [prevClassId, setPrevClassId] = useState(classId);
  const [classSwitched, setClassSwitched] = useState(false);
  if (classId !== prevClassId) {
    setPrevClassId(classId);
    setClassSwitched(true);
    setLoading(true);
    setShowAll(false);
    setActionIntent(null);
    // A failed load for the new class must not leave the previous class's rows on screen.
    setQueue([]);
  }

  // Only the newest request may change state, so a slow answer cannot overwrite a newer one.
  const latestRequest = useRef(0);
  // The class on screen now. A refresh that an alert action or panel save starts after its PATCH resolves uses the
  // fetchQueue captured at click time; reading the class here keeps it from loading the class the teacher left.
  const classIdRef = useRef(classId);
  // A class switch also retires any request still in flight for the class being left. This runs at commit, before
  // the effect below starts the new class's request, so an old answer landing in between is ignored too.
  useLayoutEffect(() => {
    classIdRef.current = classId;
    latestRequest.current += 1;
  }, [classId]);

  /**
   * Loads the queue. Returns the loaded rows, or null when the load failed. A request that a newer one replaced
   * still returns what it got, but changes no state.
   */
  const fetchQueue = useCallback(async (): Promise<InterventionQueueEntry[] | null> => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    const isLatest = () => request === latestRequest.current;
    try {
      const classIdNow = classIdRef.current;
      const url = classIdNow
        ? `/api/teacher/intervention-queue?classId=${encodeURIComponent(classIdNow)}`
        : "/api/teacher/intervention-queue";
      const data = await api.get<QueueResponse>(url);
      if (isLatest()) {
        setQueue(data.queue);
        setError(null);
      }
      return data.queue;
    } catch {
      if (isLatest()) setError("Could not load the intervention queue.");
      return null;
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The server-provided queue stands in for the first view with no class chosen. Any later class change, including
    // a switch back to all classes, needs a fetch.
    if (initialQueue !== undefined && !classId && !classSwitched) return;
    void (async () => {
      await fetchQueue();
    })();
  }, [initialQueue, fetchQueue, classId, classSwitched]);

  // The row with an open action panel stays on screen even when finishing the action drops it out of the first view.
  const openPanelStudentId = actionIntent?.student.id ?? null;
  const visible = withPinnedRow(visibleQueueRows(queue, showAll), queue, openPanelStudentId);
  const hiddenCount = queue.length - visible.length;
  // A failed refresh keeps the last good rows on screen under a banner. The list hides only while loading or empty.
  const body = queueBodyView({ loading, failed: error !== null, rowCount: queue.length });
  const listShown = body.kind === "list";
  // When no row is on screen for the open panel (the student left the queue, or no list is showing), the panel is
  // shown above the list so the teacher still sees how their action ended.
  const panelHasNoRow =
    actionIntent !== null && !(listShown && queue.some((student) => student.studentId === openPanelStudentId));
  const urgentCount = queue.filter((student) => student.signals.highSeverityAlertCount > 0).length;
  const inactivityStages = useMemo(() => countInactivityStages(queue), [queue]);

  async function handleAlertAction(alertId: string, action: QueueAlertAction) {
    setActionMessage(null);
    try {
      await api.patch(`/api/teacher/alerts/${alertId}`, {
        action,
        ...(action === "snooze" ? { hours: 24 } : {}),
      });
      setActionMessage(
        action === "snooze"
          ? "Snoozed for 24 hours."
          : action === "resolve"
            ? "Marked resolved."
            : "Dismissed.",
      );
      await fetchQueue();
    } catch {
      setActionMessage("Could not update that issue. Try again.");
    }
  }

  /**
   * Runs after an action in the inline panel has saved. The panel keeps its own message, but it cannot outlive its
   * row, so the confirmation also goes to the status line. The panel then closes if the refresh failed or the student
   * left the queue; if they are still in the queue it stays open, so a batch of reviews can continue.
   */
  async function handlePanelChanged(intent: DashboardActionIntent) {
    setActionMessage(`Saved for ${intent.student.displayName}.`);
    const loaded = await fetchQueue();
    const stillQueued = loaded?.some((student) => student.studentId === intent.student.id) ?? false;
    if (!stillQueued) setActionIntent((open) => (open === intent ? null : open));
  }

  function handleMainAction(student: InterventionQueueEntry) {
    const main = mainActionMode(student);
    if (main.mode === "panel") setActionIntent(main.intent);
    if (main.mode === "task") setTaskTarget(targetOf(student));
  }

  function handleQuickAction(student: InterventionQueueEntry, group: QueueIssueGroup) {
    const alert = group.alerts[0];
    if (!alert || !group.quickAction) return;
    const intent = buildAlertActionIntent(student, alert, group.quickAction.kind);
    if (intent) setActionIntent(intent);
  }

  function askSageToPrioritize() {
    askSage(
      buildQueueSageMessage(
        queue.map((student) => ({
          name: student.name,
          groups: groupQueueIssues(student.openAlerts, student.studentId),
        })),
      ),
    );
  }

  return (
    <section className="surface-section p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            Needs attention
          </p>
          <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Intervention Queue</h2>
          {listShown ? (
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {queue.length} student{queue.length === 1 ? "" : "s"} need follow-up
              {urgentCount > 0 ? ` · ${urgentCount} urgent` : ""}
            </p>
          ) : null}
          {inactivityStages.length > 0 ? (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              Inactive: {inactivityStages.map((stage) => `${stage.label} ${stage.count}`).join(" · ")}
            </p>
          ) : null}
        </div>
        {listShown ? (
          <button
            type="button"
            onClick={askSageToPrioritize}
            className="inline-flex min-h-11 items-center rounded-full bg-[var(--accent-strong)] px-4 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-green)]/90"
          >
            Ask Sage to prioritize
          </button>
        ) : null}
      </div>

      <p role="status" className={actionMessage ? "mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-muted)]" : "sr-only"}>
        {actionMessage ?? ""}
      </p>

      {panelHasNoRow && actionIntent ? (
        <div className="mb-3">
          <InlineActionPanel
            intent={actionIntent}
            onClose={() => setActionIntent(null)}
            onChanged={() => handlePanelChanged(actionIntent)}
          />
        </div>
      ) : null}

      {/* Body */}
      {body.kind === "loading" && <QueueSkeleton />}

      {body.kind === "error" && (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {body.kind === "empty" && (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          All students are on track. No follow-up needed right now.
        </p>
      )}

      {body.kind === "list" && (
        <>
          {body.stale ? (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2"
            >
              <p className="text-sm text-[var(--error)]">
                Could not refresh the queue. The list below may be out of date.
              </p>
              <button
                type="button"
                onClick={() => void fetchQueue()}
                aria-label="Try again to load the intervention queue"
                className="inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-4 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-raised)]"
              >
                Try again
              </button>
            </div>
          ) : null}
          <ul className="space-y-2">
            {visible.map((student) => (
              <QueueStudentRow
                key={student.studentId}
                student={student}
                now={now}
                actionPanel={
                  actionIntent?.student.id === student.studentId ? (
                    <InlineActionPanel
                      intent={actionIntent}
                      onClose={() => setActionIntent(null)}
                      onChanged={() => handlePanelChanged(actionIntent)}
                    />
                  ) : null
                }
                onMainAction={handleMainAction}
                onQuickAction={handleQuickAction}
                onAlertAction={(alertId, action) => void handleAlertAction(alertId, action)}
                onQuickTask={(row) => setTaskTarget(targetOf(row))}
                onQuickNote={(row) => setNoteTarget(targetOf(row))}
                onSchedule={(row) => setScheduleTarget(targetOf(row))}
                onAskSage={askSage}
              />
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[var(--border)] px-4 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Show {hiddenCount} more student{hiddenCount === 1 ? "" : "s"}
            </button>
          ) : null}
          {showAll && queue.length > QUEUE_ROWS_SHOWN ? (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[var(--border)] px-4 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Show fewer students
            </button>
          ) : null}
        </>
      )}

      {taskTarget && (
        <QuickTaskModal
          studentId={taskTarget.studentId}
          studentName={taskTarget.name}
          onClose={() => setTaskTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}

      {noteTarget && (
        <QuickNoteModal
          studentId={noteTarget.studentId}
          studentName={noteTarget.name}
          onClose={() => setNoteTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}

      {scheduleTarget && (
        <QuickAppointmentModal
          studentId={scheduleTarget.studentId}
          studentName={scheduleTarget.name}
          onClose={() => setScheduleTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}
    </section>
  );
}
