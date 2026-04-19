"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

interface StructuredFormResponseRow {
  id: string;
  status: "draft" | "submitted" | "reviewed" | "needs_changes";
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  updatedAt: string;
  template: { id: string; title: string; isOfficial: boolean };
  reviewedBy: { id: string; displayName: string } | null;
}

const STATUS_LABEL: Record<StructuredFormResponseRow["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  reviewed: "Reviewed",
  needs_changes: "Needs changes",
};

const STATUS_STYLE: Record<StructuredFormResponseRow["status"], string> = {
  draft: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
  submitted: "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]",
  reviewed: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]",
  needs_changes: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
};

export default function StructuredFormsSection({ studentId }: { studentId: string }) {
  const [responses, setResponses] = useState<StructuredFormResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ responses: StructuredFormResponseRow[] }>(
          `/api/teacher/students/${studentId}/structured-forms`,
        );
        if (!cancelled) setResponses(data.responses);
      } catch {
        if (!cancelled) setError("Failed to load structured form responses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <div id="structured-forms" className="theme-card rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Structured Forms</h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Program intake, assessments, and other data-reportable forms. Separate from uploaded PDF paperwork above.
          </p>
        </div>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          {responses.length} response{responses.length === 1 ? "" : "s"}
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : responses.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">No structured form responses yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {responses.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-[var(--ink-strong)]">{row.template.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {row.submittedAt
                      ? `Submitted ${new Date(row.submittedAt).toLocaleDateString()}`
                      : `Last updated ${new Date(row.updatedAt).toLocaleDateString()}`}
                    {row.reviewedBy ? ` · reviewed by ${row.reviewedBy.displayName}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${STATUS_STYLE[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              {row.reviewerNotes && (
                <p className="mt-2 rounded-md bg-[var(--surface-muted)] p-2 text-xs italic text-[var(--ink-muted)]">
                  “{row.reviewerNotes}”
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
