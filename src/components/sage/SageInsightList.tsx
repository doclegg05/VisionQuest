"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

interface SageInsight {
  id: string;
  category: "goal" | "barrier" | "strength" | "context" | "concern";
  content: string;
  confidence: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface SageInsightListProps {
  studentId?: string;
  title?: string;
  limit?: number;
  hideWhenEmpty?: boolean;
}

const CATEGORY_STYLES: Record<SageInsight["category"], string> = {
  goal: "bg-sky-100 text-sky-800",
  barrier: "bg-amber-100 text-amber-800",
  strength: "bg-emerald-100 text-emerald-800",
  context: "bg-indigo-100 text-indigo-800",
  concern: "bg-rose-100 text-rose-800",
};

function formatCategory(category: string): string {
  return category.replace(/_/g, " ");
}

export default function SageInsightList({
  studentId,
  title = "Sage Notes",
  limit = 5,
  hideWhenEmpty = false,
}: SageInsightListProps) {
  const [insights, setInsights] = useState<SageInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    const params = new URLSearchParams({
      status: "active",
      limit: String(limit),
    });
    if (studentId) params.set("studentId", studentId);

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sage/insights?${params.toString()}`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load Sage notes.");
      }
      setInsights((payload?.insights ?? []) as SageInsight[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Sage notes.");
    } finally {
      setLoading(false);
    }
  }, [limit, studentId]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  async function dismissInsight(insightId: string) {
    setUpdatingId(insightId);
    setError(null);
    try {
      const response = await fetch(`/api/sage/insights/${insightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "dismissed" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not dismiss this note.");
      }
      setInsights((current) => current.filter((insight) => insight.id !== insightId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss this note.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!loading && insights.length === 0 && hideWhenEmpty) {
    return null;
  }

  return (
    <section className="surface-section p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Structured observations Sage saved from recent coaching.
          </p>
        </div>
        {insights.length > 0 ? (
          <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
            {insights.length} active
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">Loading Sage notes...</p>
      ) : insights.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">No active Sage notes yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {insights.map((insight) => (
            <article
              key={insight.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${CATEGORY_STYLES[insight.category]}`}>
                    {formatCategory(insight.category)}
                  </span>
                  <p className="mt-3 text-sm leading-6 text-[var(--ink-strong)]">
                    {insight.content}
                  </p>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">
                    Saved {new Date(insight.createdAt).toLocaleDateString()}
                    {typeof insight.confidence === "number"
                      ? ` • confidence ${Math.round(insight.confidence * 100)}%`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissInsight(insight.id)}
                  disabled={updatingId === insight.id}
                  title="Dismiss Sage note"
                  aria-label="Dismiss Sage note"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--ink-muted)] transition hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)] disabled:opacity-50"
                >
                  <X size={15} weight="bold" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
