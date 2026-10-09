"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FormDialog } from "@/components/ui/FormDialog";
import { api, apiFetch } from "@/lib/api";
import { type FieldDef } from "@/lib/forms/schema";

interface TemplateSummary {
  id: string;
  title: string;
  status: "active" | "archived";
  responseCount: number;
}

interface ResponseRow {
  id: string;
  status: "draft" | "submitted" | "reviewed" | "needs_changes";
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  student: { id: string; studentId: string; displayName: string };
  reviewedBy: { id: string; displayName: string } | null;
}

interface ResponseDetail {
  id: string;
  templateId: string;
  studentId: string;
  answers: Record<string, unknown>;
  status: ResponseRow["status"];
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  student: ResponseRow["student"];
  template: {
    id: string;
    title: string;
    schema: FieldDef[];
  };
}

type ReviewStatus = "reviewed" | "needs_changes";

const STATUS_LABEL: Record<ResponseRow["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  reviewed: "Reviewed",
  needs_changes: "Needs changes",
};

export default function FormResponsesReview() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<{ templates: TemplateSummary[] }>("/api/teacher/forms/templates");
        setTemplates(data.templates);
        if (data.templates.length > 0) {
          setSelectedTemplateId((current) => current || data.templates[0].id);
        }
      } catch {
        setError("Failed to load templates.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fetchResponses = useCallback(async (templateId: string) => {
    try {
      const data = await api.get<{ responses: ResponseRow[] }>(
        `/api/teacher/forms/responses?templateId=${encodeURIComponent(templateId)}`,
      );
      setResponses(data.responses);
    } catch {
      setError("Failed to load responses.");
    }
  }, []);

  useEffect(() => {
    if (!selectedTemplateId) return;
    async function run() {
      await fetchResponses(selectedTemplateId);
    }
    void run();
  }, [selectedTemplateId, fetchResponses]);

  async function openResponse(id: string) {
    try {
      const data = await api.get<{ response: ResponseDetail }>(`/api/teacher/forms/responses/${id}`);
      setDetail(data.response);
    } catch {
      setError("Failed to open response.");
    }
  }

  // Rejects on failure: the review dialog is modal, so the page-level alert
  // below is inert while it is open. ReviewDrawer shows the message instead.
  async function handleReview(id: string, status: ReviewStatus, reviewerNotes: string | undefined) {
    const res = await apiFetch(`/api/teacher/forms/responses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewerNotes }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? "Review failed.");
    }
    setDetail(null);
    if (selectedTemplateId) await fetchResponses(selectedTemplateId);
  }

  const activeTemplates = useMemo(
    () => templates.filter((template) => template.status === "active"),
    [templates],
  );

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading…</p>;

  if (activeTemplates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
        No active templates yet. Create one from the Templates tab to collect responses.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      <label className="inline-flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Template</span>
        <select
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          className="field px-3 py-2 text-sm"
        >
          {activeTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.title} ({template.responseCount})
            </option>
          ))}
        </select>
      </label>

      {responses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No responses yet for this template.
        </p>
      ) : (
        <ul className="space-y-2">
          {responses.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[var(--ink-strong)] truncate">{row.student.displayName}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {STATUS_LABEL[row.status]}
                  {row.submittedAt ? ` · submitted ${new Date(row.submittedAt).toLocaleDateString()}` : ""}
                  {row.reviewedAt && row.reviewedBy
                    ? ` · reviewed by ${row.reviewedBy.displayName}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void openResponse(row.id)}
                className="inline-flex items-center rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold pointer-coarse:min-h-11"
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail && <ReviewDrawer response={detail} onClose={() => setDetail(null)} onReview={handleReview} />}
    </div>
  );
}

interface ReviewDrawerProps {
  response: ResponseDetail;
  onClose: () => void;
  /** Rejects with an Error whose message the dialog shows to the teacher. */
  onReview: (id: string, status: ReviewStatus, notes: string | undefined) => Promise<void>;
}

/**
 * Runs a review and returns the message to show inside the review dialog,
 * or null when it succeeded.
 */
export async function runReview(review: () => Promise<void>): Promise<string | null> {
  try {
    await review();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Review failed.";
  }
}

export function ReviewDrawer({ response, onClose, onReview }: ReviewDrawerProps) {
  const initialNotes = response.reviewerNotes ?? "";
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const canReview = response.status === "submitted" || response.status === "needs_changes" || response.status === "reviewed";

  async function submitReview(status: ReviewStatus, reviewerNotes: string | undefined) {
    setSubmitting(true);
    setReviewError(null);
    const failure = await runReview(() => onReview(response.id, status, reviewerNotes));
    setReviewError(failure);
    setSubmitting(false);
  }

  return (
    <FormDialog
      title={response.template.title}
      dirty={notes !== initialNotes}
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--ink-muted)]">{response.student.displayName}</p>

        <div className="space-y-3">
          {response.template.schema.map((field) => (
            <div key={field.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{field.label}</p>
              <p className="mt-1 text-sm text-[var(--ink-strong)] whitespace-pre-wrap break-words">
                {formatAnswer(field, response.answers[field.key])}
              </p>
            </div>
          ))}
        </div>

        <section className="space-y-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Reviewer notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Add notes for the student (required when kicking back)…"
              className="field w-full px-3 py-2 text-sm"
            />
          </label>
        </section>

        {reviewError && (
          <p role="alert" className="text-sm text-[var(--badge-error-text)]">
            {reviewError}
          </p>
        )}

        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !canReview || !notes.trim()}
            onClick={() => void submitReview("needs_changes", notes.trim())}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--accent-red)] disabled:opacity-50"
          >
            Needs changes
          </button>
          <button
            type="button"
            disabled={submitting || !canReview}
            onClick={() => void submitReview("reviewed", notes.trim() || undefined)}
            className="primary-button px-5 py-2 text-sm disabled:opacity-50"
          >
            Mark reviewed
          </button>
        </footer>
      </div>
    </FormDialog>
  );
}

function formatAnswer(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "multiselect" && Array.isArray(value)) return value.join(", ");
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "attachment" && typeof value === "object" && value !== null && "fileId" in value) {
    return `File: ${(value as { fileId: string }).fileId}`;
  }
  return String(value);
}
