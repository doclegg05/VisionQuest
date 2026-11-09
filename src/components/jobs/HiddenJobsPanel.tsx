"use client";

import { useEffect, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";

/** One open "Not interested" choice, as GET /api/jobs/hidden returns it. */
export interface HiddenJobItem {
  id: string;
  snapshotTitle: string;
  snapshotCompany: string;
  snapshotLocation: string;
}

export interface HiddenJobsState {
  hideEnabled: boolean;
  hiddenJobs: HiddenJobItem[];
  loadFailed: boolean;
}

const HIDDEN_OFF: HiddenJobsState = { hideEnabled: false, hiddenJobs: [], loadFailed: false };

export const RESTORE_ERROR_MESSAGE = "We couldn't bring that job back. Try again.";
export const HIDDEN_LOAD_ERROR_MESSAGE = "We couldn't load the jobs you hid. Refresh the page to try again.";

/**
 * Loads the student's hidden jobs and whether hiding is on. Until the answer
 * arrives, and if it fails, hiding stays off: no Not interested buttons show,
 * and a failed load says so in the panel instead of hiding the problem.
 */
export function useHiddenJobs(refreshKey: number): HiddenJobsState {
  const [state, setState] = useState<HiddenJobsState>(HIDDEN_OFF);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/jobs/hidden", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`hidden jobs request failed with ${res.status}`);
        const body = (await res.json()) as { hideEnabled: boolean; hiddenJobs: HiddenJobItem[] };
        setState({ hideEnabled: body.hideEnabled, hiddenJobs: body.hiddenJobs, loadFailed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ ...HIDDEN_OFF, loadFailed: true });
      });
    return () => controller.abort();
  }, [refreshKey]);

  return state;
}

interface HiddenJobsPanelProps {
  state: HiddenJobsState;
  onRestore: (hiddenJobId: string) => Promise<void>;
}

/**
 * "Jobs you hid": every job the student marked Not interested, each with a
 * real Restore button (44px). Renders nothing while hiding is off and the
 * student has hidden nothing.
 */
export function HiddenJobsPanel({ state, onRestore }: HiddenJobsPanelProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.loadFailed) {
    return <p role="alert" className="text-sm text-danger">{HIDDEN_LOAD_ERROR_MESSAGE}</p>;
  }
  if (!state.hideEnabled || state.hiddenJobs.length === 0) return null;

  async function restore(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await onRestore(id);
    } catch {
      setError(RESTORE_ERROR_MESSAGE);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <details className="surface-section rounded-xl border border-[var(--border)] p-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[var(--ink-strong)]">
        {`Jobs you hid (${state.hiddenJobs.length})`}
      </summary>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        You said you are not interested in these jobs. Tap Restore to see a job again.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 space-y-2">
        {state.hiddenJobs.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-[var(--ink-strong)]">
              {job.snapshotTitle} <span className="text-[var(--ink-muted)]">at {job.snapshotCompany}, {job.snapshotLocation}</span>
            </span>
            <button
              type="button"
              onClick={() => void restore(job.id)}
              disabled={pendingId !== null}
              aria-label={`Restore ${job.snapshotTitle}`}
              className="flex min-h-11 min-w-11 items-center gap-1 rounded-lg bg-[var(--surface-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)] disabled:opacity-50"
            >
              <ArrowCounterClockwise size={14} aria-hidden="true" />
              {pendingId === job.id ? "Restoring..." : "Restore"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
