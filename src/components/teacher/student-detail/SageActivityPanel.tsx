"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Safe, allowlisted shape of one ledger row — mirrors
 * SageOperationLedgerRow in src/lib/sage/operations.ts. Deliberately does
 * NOT include payload or resultSummary: those fields are proven (see that
 * file's header comment) to embed quoted free text for some tools, and the
 * crisis-era "no transcript access" decision means this viewer shows
 * OPERATIONS only, never anything that could carry conversation content.
 */
export interface SageOperationRow {
  id: string;
  toolName: string;
  targetSummary: string;
  status: string;
  statusLabel: string;
  actorRole: string;
  actorRoleLabel: string;
  createdAt: string;
  updatedAt: string;
}

type LoadResult =
  | { ok: true; operations: SageOperationRow[]; hasMore: boolean }
  | { ok: false; error: string };

/**
 * Pure fetch-and-parse logic, split out from the component so it is
 * testable without a DOM (mirrors submitPathwayCluster in
 * DiscoveryClusterPicker.tsx).
 */
export async function loadSageOperations(
  studentId: string,
  page: number,
  fetchFn: typeof fetch = fetch,
): Promise<LoadResult> {
  try {
    const res = await fetchFn(`/api/teacher/students/${studentId}/sage-operations?page=${page}`, {
      credentials: "include",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: json?.error || "Could not load Sage's activity for this student." };
    }
    return {
      ok: true,
      operations: (json?.data?.operations ?? []) as SageOperationRow[],
      hasMore: Boolean(json?.data?.hasMore),
    };
  } catch {
    return { ok: false, error: "Could not load Sage's activity for this student." };
  }
}

function statusBadgeClass(status: string): string {
  if (status === "executed" || status === "confirmed") return "bg-emerald-100 text-emerald-700";
  if (status === "failed" || status === "rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800"; // proposed / unrecognized
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Presentational only — no fetching, no state. Kept separate for testing. */
export function SageActivityList({ operations }: { operations: SageOperationRow[] }) {
  if (operations.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--ink-faint)]">
        Sage has not made any changes for this student.
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-2">
      {operations.map((operation) => (
        <li key={operation.id} className="theme-input flex flex-wrap items-center justify-between gap-3 rounded-lg p-3">
          <div>
            <p className="text-sm text-[var(--ink-strong)]">{operation.targetSummary}</p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              {operation.actorRoleLabel} · {dateFormatter.format(new Date(operation.createdAt))}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(operation.status)}`}
          >
            {operation.statusLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface SageActivityPanelProps {
  studentId: string;
}

/**
 * What Sage DID for this student — a read-only viewer for the SageOperation
 * write ledger. Shows operations only (tool run, what it targeted, status,
 * when, who confirmed) — never conversation content or transcripts.
 */
export function SageActivityPanel({ studentId }: SageActivityPanelProps) {
  const [operations, setOperations] = useState<SageOperationRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (targetPage: number, append: boolean) => {
    if (append) setLoadingMore(true);
    const result = await loadSageOperations(studentId, targetPage);
    if (result.ok) {
      setOperations((current) => (append ? [...(current ?? []), ...result.operations] : result.operations));
      setHasMore(result.hasMore);
      setError(null);
    } else {
      setError(result.error);
      if (!append) setOperations([]);
    }
    if (append) setLoadingMore(false);
  }, [studentId]);

  useEffect(() => {
    async function run() {
      await load(1, false);
    }
    void run();
  }, [load]);

  const loadMore = async () => {
    const nextPage = page + 1;
    setPage(nextPage);
    await load(nextPage, true);
  };

  return (
    <div className="theme-card rounded-xl p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-secondary)]">
        Sage&apos;s activity
      </p>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        What Sage has done for this student — confirmed writes only, never conversation content.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {operations === null ? (
        <p className="mt-3 text-sm text-[var(--ink-faint)]">Loading…</p>
      ) : (
        <>
          <SageActivityList operations={operations} />
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 min-h-11 rounded-lg px-3 text-xs font-semibold text-[var(--accent-secondary)] hover:bg-[var(--surface-interactive)] disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
