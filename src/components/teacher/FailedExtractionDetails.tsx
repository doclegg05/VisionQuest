"use client";

import { api } from "@/lib/api";

/**
 * The reason a failed extraction failed, loaded one row at a time. The list
 * route returns no error text: it can quote a model reply, and reading it
 * writes a staff view row against the student (GET
 * /api/teacher/failed-extractions/:id), so it loads only when asked.
 */

export type FailureDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; reason: string }
  | { status: "failed" };

interface DetailResponse {
  success: boolean;
  data: { id: string; error: string };
}

export async function fetchFailureReason(id: string): Promise<string> {
  const res = await api.get<DetailResponse>(`/api/teacher/failed-extractions/${id}`);
  return res.data.error;
}

interface FailureDetailsViewProps {
  state: FailureDetailState;
  onShow: () => void;
}

export function FailureDetailsView({ state, onShow }: FailureDetailsViewProps) {
  if (state.status === "loaded") {
    return <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{state.reason}</p>;
  }

  const loading = state.status === "loading";
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={onShow}
        className="inline-flex items-center pointer-coarse:min-h-11 text-xs font-semibold text-[var(--ink-strong)] underline underline-offset-2 disabled:opacity-50"
      >
        {loading ? "Loading..." : state.status === "failed" ? "Try again" : "Show what went wrong"}
      </button>
      {state.status === "failed" && (
        <span className="text-xs text-danger" role="alert">
          Could not load the reason.
        </span>
      )}
    </div>
  );
}
