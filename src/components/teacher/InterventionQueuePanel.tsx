"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Warning, Target, CalendarX, UserCircle } from "@phosphor-icons/react";
import { api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueueStudent {
  studentId: string;
  name: string;
  email: string | null;
  urgencyScore: number;
  signals: {
    stalledGoalCount: number;
    highSeverityAlertCount: number;
    overdueTaskCount: number;
    daysSinceLastLogin: number;
    orientationComplete: boolean;
    orientationProgress: number;
    readinessScore: number;
  };
}

interface QueueResponse {
  queue: QueueStudent[];
}

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

// ─── Student Row ──────────────────────────────────────────────────────────────

function StudentRow({ student }: { student: QueueStudent }) {
  const badge = urgencyBadge(student.urgencyScore);
  const reason = topReason(student.signals);
  const { signals } = student;

  return (
    <Link
      href={`/teacher/students/${student.studentId}`}
      className="flex items-center gap-3 rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 transition-colors hover:bg-[rgba(18,38,63,0.04)]"
    >
      {/* Avatar placeholder */}
      <UserCircle
        size={32}
        weight="light"
        className="shrink-0 text-[var(--ink-muted)]"
      />

      {/* Name + reason */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--ink-strong)]">
          {student.name}
        </p>
        <p className="truncate text-xs text-[var(--ink-muted)]">{reason}</p>
      </div>

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
      </div>

      {/* Urgency badge */}
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badge.color}`}
      >
        {badge.label}
      </span>
    </Link>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InterventionQueuePanel() {
  const [queue, setQueue] = useState<QueueStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchQueue() {
      try {
        const data = await api.get<QueueResponse>("/api/teacher/intervention-queue");
        setQueue(data.queue);
      } catch {
        setError("Failed to load intervention queue.");
      } finally {
        setLoading(false);
      }
    }

    void fetchQueue();
  }, []);

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
            <StudentRow key={student.studentId} student={student} />
          ))}
        </div>
      )}
    </section>
  );
}
