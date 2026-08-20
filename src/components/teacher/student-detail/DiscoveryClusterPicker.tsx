"use client";

// ---------------------------------------------------------------------------
// The exit from the awaiting_cluster dead end.
//
// Career discovery can land "complete" with an empty topClusters — the Sage
// extractor reports the stage done but records no cluster, or staff used the
// cluster-blind override. The student then sits on a finished discovery with
// no pathway to build a plan from, and until now no screen could set one.
// PATCH /api/teacher/students/[id]/discovery accepts a validated clusterId;
// this is its only caller.
//
// Presentational and controlled on purpose: OverviewTab owns the state, so
// every state here (idle / chosen / saving / error / saved) renders from
// props and is directly testable.
// ---------------------------------------------------------------------------

import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

/** Shared between the label's htmlFor and the select's id. */
export const CLUSTER_SELECT_ID = "discovery-cluster-select";

/**
 * The awaiting_cluster state: discovery finished, but no pathway was ever
 * recorded. Anything else — still running, never started, or a cluster
 * already set — needs no picker.
 */
export function needsPathwayCluster(
  discovery: { status: string; topClusters: readonly string[] } | null,
): boolean {
  return discovery !== null && discovery.status === "complete" && discovery.topClusters.length === 0;
}

export type SubmitClusterResult = { ok: true } | { ok: false; error: string };

const SAVE_FAILED = "Could not save the pathway. Try again.";

/**
 * PATCH the discovery override route with the chosen cluster. Never throws —
 * the caller renders whatever message comes back.
 */
export async function submitPathwayCluster(
  studentId: string,
  clusterId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubmitClusterResult> {
  try {
    const res = await fetchFn(`/api/teacher/students/${studentId}/discovery`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "complete", clusterId }),
    });
    if (res.ok) return { ok: true };

    const payload: unknown = await res.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : SAVE_FAILED;
    return { ok: false, error: message };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}

export interface DiscoveryClusterPickerProps {
  /** Currently selected cluster id, or "" for no choice yet. */
  value: string;
  onChange: (clusterId: string) => void;
  onConfirm: () => void;
  saving: boolean;
  error: string | null;
  /** Set once a pathway saved — the picker closes and reports the result. */
  savedClusterId: string | null;
}

function clusterLabel(clusterId: string): string {
  return CAREER_CLUSTERS.find((cluster) => cluster.id === clusterId)?.label ?? clusterId;
}

export function DiscoveryClusterPicker({
  value,
  onChange,
  onConfirm,
  saving,
  error,
  savedClusterId,
}: DiscoveryClusterPickerProps) {
  if (savedClusterId) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-sm text-emerald-900">
          Pathway saved: <strong>{clusterLabel(savedClusterId)}</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm text-amber-900">Sage did not record a pathway. Pick one to set it.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={CLUSTER_SELECT_ID}
            className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]"
          >
            Career pathway
          </label>
          <select
            id={CLUSTER_SELECT_ID}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="field min-h-[44px] rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Choose a pathway</option>
            {CAREER_CLUSTERS.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving || value === ""}
          className="min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save pathway"}
        </button>
      </div>
      <p role="alert" aria-live="polite" className="mt-2 text-xs text-red-600">
        {error}
      </p>
    </div>
  );
}
