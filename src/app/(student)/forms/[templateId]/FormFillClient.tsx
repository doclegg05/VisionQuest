"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api, apiFetch } from "@/lib/api";
import type { Answers, FieldDef } from "@/lib/forms/schema";

interface TemplatePayload {
  id: string;
  title: string;
  description: string | null;
  schema: FieldDef[];
  status: "active" | "archived";
  dueAt: string | null;
  requiredForCompletion: boolean;
}

interface ResponsePayload {
  id: string;
  answers: Answers;
  status: "draft" | "submitted" | "reviewed" | "needs_changes";
  submittedAt: string | null;
  reviewerNotes: string | null;
  updatedAt: string;
}

interface FetchResult {
  template: TemplatePayload;
  response: ResponsePayload | null;
}

export default function FormFillClient({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [data, setData] = useState<FetchResult | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<ResponsePayload["status"] | "not_started">("not_started");
  const [message, setMessage] = useState<string | null>(null);

  const loadForm = useCallback(async () => {
    try {
      const res = await api.get<FetchResult>(`/api/student/forms/${templateId}`);
      setData(res);
      setAnswers(res.response?.answers ?? {});
      setStatus(res.response?.status ?? "not_started");
    } catch {
      setError("We couldn’t load this form.");
    }
  }, [templateId]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  if (!data && !error) return <p className="page-shell text-sm text-[var(--ink-muted)]">Loading…</p>;
  if (error || !data) {
    return (
      <div className="page-shell space-y-3">
        <p className="text-sm text-[var(--error)]">{error}</p>
        <Link href="/forms" className="text-sm text-[var(--accent-green)]">
          ← Back to forms
        </Link>
      </div>
    );
  }

  const { template, response } = data;
  const readOnly = status === "submitted" || status === "reviewed";

  function setFieldValue(key: string, value: Answers[string] | undefined) {
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined || value === null || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  async function saveDraft() {
    setSavingDraft(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/student/forms/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Save failed");
      }
      setMessage("Draft saved.");
      await loadForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function submitForm() {
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const savedDraft = await apiFetch(`/api/student/forms/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!savedDraft.ok) {
        const body = await savedDraft.json().catch(() => null);
        throw new Error(body?.error ?? "Could not save before submitting.");
      }
      const res = await apiFetch(`/api/student/forms/${templateId}/submit`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Submit failed");
      }
      setMessage("Submitted. Your instructor will review and get back to you.");
      await loadForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell space-y-5">
      <div>
        <Link href="/forms" className="text-sm text-[var(--accent-green)]">
          ← Back to forms
        </Link>
        <h1 className="mt-2 font-display text-3xl text-[var(--ink-strong)]">{template.title}</h1>
        {template.description && (
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{template.description}</p>
        )}
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          Status: <strong>{statusLabel(status)}</strong>
          {template.dueAt ? ` · due ${new Date(template.dueAt).toLocaleDateString()}` : ""}
          {template.requiredForCompletion ? " · required" : ""}
        </p>
      </div>

      {response?.reviewerNotes && status === "needs_changes" && (
        <div className="rounded-xl border border-[var(--badge-warning-bg)] bg-[var(--badge-warning-bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--badge-warning-text)]">
            Notes from your instructor
          </p>
          <p className="mt-1 text-sm text-[var(--ink-strong)] whitespace-pre-wrap">
            {response.reviewerNotes}
          </p>
        </div>
      )}

      {message && (
        <p
          role="status"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--accent-green)]"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]"
        >
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!readOnly) void submitForm();
        }}
        className="space-y-4"
      >
        {template.schema.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={answers[field.key]}
            onChange={(value) => setFieldValue(field.key, value)}
            disabled={readOnly}
          />
        ))}

        {!readOnly && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={savingDraft || submitting}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:opacity-50"
            >
              {savingDraft ? "Saving…" : "Save draft"}
            </button>
            <button
              type="submit"
              disabled={submitting || savingDraft}
              className="primary-button px-5 py-2 text-sm disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        )}

        {readOnly && (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
            This form is locked — your instructor has it. If they send it back for changes, you can edit it again.
          </p>
        )}
      </form>
    </div>
  );
}

function statusLabel(status: "draft" | "submitted" | "reviewed" | "needs_changes" | "not_started"): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "reviewed":
      return "Reviewed";
    case "needs_changes":
      return "Needs changes";
    case "draft":
      return "In progress";
    default:
      return "Not started";
  }
}

interface FieldInputProps {
  field: FieldDef;
  value: Answers[string] | undefined;
  onChange: (value: Answers[string] | undefined) => void;
  disabled: boolean;
}

function FieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-2">
      <label className="block">
        <span className="text-sm font-semibold text-[var(--ink-strong)]">
          {field.label}
          {field.required && <span className="ml-1 text-[var(--accent-red)]">*</span>}
        </span>
        {field.helpText && (
          <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{field.helpText}</span>
        )}
        <div className="mt-2">
          <FieldWidget field={field} value={value} onChange={onChange} disabled={disabled} />
        </div>
      </label>
    </div>
  );
}

function FieldWidget({ field, value, onChange, disabled }: FieldInputProps) {
  switch (field.type) {
    case "text":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="field w-full px-3 py-2 text-sm"
        />
      );
    case "longText":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          maxLength={field.maxLength}
          disabled={disabled}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
          className="field w-full px-3 py-2 text-sm"
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          disabled={disabled}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
          className="field w-full px-3 py-2 text-sm"
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || undefined)}
          className="field w-full px-3 py-2 text-sm"
        />
      );
    case "select":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || undefined)}
          className="field w-full px-3 py-2 text-sm"
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-3">
          {field.options.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                disabled={disabled}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option]
                    : selected.filter((entry) => entry !== option);
                  onChange(next.length > 0 ? next : undefined);
                }}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          Yes
        </label>
      );
    case "attachment":
      return (
        <AttachmentField value={value} disabled={disabled} onChange={onChange} />
      );
  }
}

function AttachmentField({
  value,
  disabled,
  onChange,
}: {
  value: Answers[string] | undefined;
  disabled: boolean;
  onChange: (value: Answers[string] | undefined) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileId = typeof value === "object" && value !== null && "fileId" in value ? (value as { fileId: string }).fileId : null;

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", "form_attachment");
      const res = await apiFetch("/api/files", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Upload failed");
      }
      const body = (await res.json()) as { file?: { id: string } };
      if (!body.file?.id) throw new Error("Upload returned no file id");
      onChange({ fileId: body.file.id });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {fileId ? (
        <p className="text-xs text-[var(--ink-muted)]">Attached file: <code>{fileId}</code></p>
      ) : (
        <p className="text-xs text-[var(--ink-faint)]">No file uploaded yet.</p>
      )}
      {!disabled && (
        <input
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
          }}
          className="text-sm"
        />
      )}
      {uploading && <p className="text-xs text-[var(--ink-muted)]">Uploading…</p>}
      {uploadError && <p className="text-xs text-[var(--error)]">{uploadError}</p>}
    </div>
  );
}
