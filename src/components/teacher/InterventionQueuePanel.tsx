"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Warning, Target, CalendarX, UserCircle, ClipboardText, DotsThree } from "@phosphor-icons/react";
import { api, apiFetch } from "@/lib/api";
import {
  type InterventionQueueResponse as QueueResponse,
  type QueueStudent,
} from "@/lib/teacher/dashboard";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyBadge(score: number): { label: string; color: string } {
  if (score >= 50) return { label: "Critical", color: "bg-red-100 text-red-700" };
  if (score >= 25) return { label: "High", color: "bg-amber-100 text-amber-700" };
  return { label: "Medium", color: "bg-yellow-100 text-yellow-700" };
}

function topReason(signals: QueueStudent["signals"]): string {
  if (signals.highSeverityAlertCount > 0)
    return `${signals.highSeverityAlertCount} alert${signals.highSeverityAlertCount !== 1 ? "s" : ""}`;
  if (signals.stalledGoalCount > 0)
    return `${signals.stalledGoalCount} stalled goal${signals.stalledGoalCount !== 1 ? "s" : ""}`;
  if (signals.overdueTaskCount > 0)
    return `${signals.overdueTaskCount} overdue task${signals.overdueTaskCount !== 1 ? "s" : ""}`;
  if (signals.unmatchedGoalCount > 0)
    return `${signals.unmatchedGoalCount} unmatched goal${signals.unmatchedGoalCount !== 1 ? "s" : ""}`;
  if (signals.daysSinceLastLogin > 7) return `${signals.daysSinceLastLogin}d since login`;
  if (!signals.orientationComplete)
    return `Orientation ${Math.round(signals.orientationProgress * 100)}%`;
  return "Low readiness";
}

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

// ─── Quick Task Modal ─────────────────────────────────────────────────────────

function QuickTaskModal({
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3"
      >
        <h3 className="text-sm font-semibold text-gray-700">
          Quick task for {studentName}
        </h3>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input
          type="text"
          placeholder="What needs to be done?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 px-3 py-1.5">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Task"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Student Row ──────────────────────────────────────────────────────────────

function StudentRow({
  student,
  onQuickTask,
}: {
  student: QueueStudent;
  onQuickTask: (studentId: string, name: string) => void;
}) {
  const badge = urgencyBadge(student.urgencyScore);
  const reason = topReason(student.signals);
  const { signals } = student;

  return (
    <div className="flex items-center gap-3 rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 transition-colors hover:bg-[rgba(18,38,63,0.04)]">
      {/* Avatar placeholder */}
      <Link href={`/teacher/students/${student.studentId}`} className="shrink-0">
        <UserCircle
          size={32}
          weight="light"
          className="text-[var(--ink-muted)]"
        />
      </Link>

      {/* Name + reason */}
      <Link href={`/teacher/students/${student.studentId}`} className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--ink-strong)]">
          {student.name}
        </p>
        <p className="truncate text-xs text-[var(--ink-muted)]">{reason}</p>
      </Link>

      {/* Signal icons */}
      <div className="flex shrink-0 items-center gap-2 text-[var(--ink-muted)]">
        {signals.stalledGoalCount > 0 && (
          <span title={`${signals.stalledGoalCount} stalled goal(s)`}>
            <Target size={16} weight="duotone" className="text-amber-500" />
          </span>
        )}
        {signals.overdueTaskCount > 0 && (
          <span title={`${signals.overdueTaskCount} overdue task(s)`}>
            <CalendarX size={16} weight="duotone" className="text-orange-500" />
          </span>
        )}
        {signals.highSeverityAlertCount > 0 && (
          <span title={`${signals.highSeverityAlertCount} high-severity alert(s)`}>
            <Warning size={16} weight="duotone" className="text-red-500" />
          </span>
        )}
        {signals.unmatchedGoalCount > 0 && (
          <span title={`${signals.unmatchedGoalCount} goal(s) without pathway`}>
            <ClipboardText size={16} weight="duotone" className="text-purple-500" />
          </span>
        )}
      </div>

      {/* Quick action */}
      <button
        onClick={(e) => {
          e.preventDefault();
          onQuickTask(student.studentId, student.name);
        }}
        title="Assign quick task"
        className="shrink-0 rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-gray-100 hover:text-gray-700"
      >
        <DotsThree size={18} weight="bold" />
      </button>

      {/* Urgency badge */}
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badge.color}`}
      >
        {badge.label}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InterventionQueuePanel({
  initialQueue,
}: {
  initialQueue?: QueueStudent[];
}) {
  const [queue, setQueue] = useState<QueueStudent[]>(initialQueue ?? []);
  const [loading, setLoading] = useState(initialQueue === undefined);
  const [error, setError] = useState<string | null>(null);
  const [taskTarget, setTaskTarget] = useState<{ studentId: string; name: string } | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const data = await api.get<QueueResponse>("/api/teacher/intervention-queue");
      setQueue(data.queue);
    } catch {
      setError("Failed to load intervention queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQueue !== undefined) return;
    void fetchQueue();
  }, [initialQueue, fetchQueue]);

  return (
    <section className="surface-section p-5">
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
          Needs attention
        </p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
          Intervention Queue
        </h2>
        {!loading && !error && queue.length > 0 && (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {queue.length} student{queue.length !== 1 ? "s" : ""} need follow-up
          </p>
        )}
      </div>

      {/* Body */}
      {loading && <QueueSkeleton />}

      {!loading && error && (
        <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && queue.length === 0 && (
        <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
          All students are on track. No interventions needed right now.
        </p>
      )}

      {!loading && !error && queue.length > 0 && (
        <div className="space-y-2">
          {queue.map((student) => (
            <StudentRow
              key={student.studentId}
              student={student}
              onQuickTask={(id, name) => setTaskTarget({ studentId: id, name })}
            />
          ))}
        </div>
      )}

      {/* Quick Task Modal */}
      {taskTarget && (
        <QuickTaskModal
          studentId={taskTarget.studentId}
          studentName={taskTarget.name}
          onClose={() => setTaskTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}
    </section>
  );
}
