"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { api } from "@/lib/api";

interface FailedExtractionRow {
  id: string;
  studentId: string;
  conversationId: string | null;
  extractorKey: string;
  error: string;
  attempts: number;
  status: string;
  createdAt: string;
  student: { displayName: string; studentId: string };
}

interface ListResponse {
  success: boolean;
  data: FailedExtractionRow[];
}

interface ActionResponse {
  success: boolean;
  data: { status: string; created?: number; duplicate?: number; rejected?: number };
}

const REPLAYABLE_KEY = "goal_extraction";

const EXTRACTOR_LABELS: Record<string, string> = {
  goal_extraction: "Goal extraction",
  mood_extraction_exhausted: "Mood check",
  classroom_confirmation_exhausted: "Classroom confirmation",
  discovery_extraction_exhausted: "Career discovery",
};

function extractorLabel(key: string): string {
  return EXTRACTOR_LABELS[key] ?? key;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function replaySummary(data: ActionResponse["data"]): string {
  const created = data.created ?? 0;
  if (created > 0) {
    return `Replay succeeded — ${created} goal${created !== 1 ? "s" : ""} proposed for review.`;
  }
  return "Replay ran, but no new goals were found this time.";
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading failed extractions">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-[1.15rem] bg-[var(--border)] opacity-60" />
      ))}
    </div>
  );
}

function FailureRow({
  row,
  busy,
  onAction,
}: {
  row: FailedExtractionRow;
  busy: boolean;
  onAction: (id: string, action: "replay" | "dismiss") => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 lg:flex-row lg:items-center">
      <WarningCircle size={24} weight="duotone" className="shrink-0 text-amber-500" aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/teacher/students/${row.studentId}`}
            className="truncate text-sm font-semibold text-[var(--ink-strong)] hover:underline"
          >
            {row.student.displayName}
          </Link>
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
            {extractorLabel(row.extractorKey)}
          </span>
          <span className="text-xs text-[var(--ink-faint)]">
            {formatWhen(row.createdAt)} · {row.attempts} attempt{row.attempts !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-muted)]" title={row.error}>
          {row.error}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {row.extractorKey === REPLAYABLE_KEY && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(row.id, "replay")}
            className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-green)]/90 disabled:opacity-50"
          >
            <ArrowClockwise size={14} weight="bold" aria-hidden />
            {busy ? "Replaying..." : "Replay"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(row.id, "dismiss")}
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] disabled:opacity-50"
        >
          <CheckCircle size={14} weight="regular" aria-hidden />
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function FailedExtractionsPanel() {
  const [rows, setRows] = useState<FailedExtractionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const res = await api.get<ListResponse>("/api/teacher/failed-extractions");
      setRows(res.data);
      setError(null);
    } catch {
      setError("Failed to load failed extractions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  async function handleAction(id: string, action: "replay" | "dismiss") {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await api.post<ActionResponse>(`/api/teacher/failed-extractions/${id}`, { action });
      setMessage(action === "dismiss" ? "Failure dismissed." : replaySummary(res.data));
      await fetchRows();
    } catch (err: unknown) {
      setMessage(err instanceof Error && err.message ? err.message : "Could not update that failure.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="surface-section p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
          Sage operations
        </p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Failed extractions</h2>
        {!loading && !error && rows.length > 0 && (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {rows.length} open failure{rows.length !== 1 ? "s" : ""} awaiting review
          </p>
        )}
        {message && (
          <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-muted)]" role="status">
            {message}
          </p>
        )}
      </div>

      {loading && <ListSkeleton />}

      {!loading && error && (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No failed extractions. Sage&apos;s background analysis is running clean.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <FailureRow key={row.id} row={row} busy={busyId === row.id} onAction={(id, action) => void handleAction(id, action)} />
          ))}
        </div>
      )}
    </section>
  );
}
