"use client";

import Link from "next/link";
import type { SpokesForm } from "@/lib/spokes/forms";
import FormUploadButton from "@/components/ui/FormUploadButton";

interface ResourceCardProps {
  form: SpokesForm;
  submissionStatus?: string | null;
  onUploadComplete?: () => void;
}

export default function ResourceCard({ form, submissionStatus, onUploadComplete }: ResourceCardProps) {
  const audienceLabel =
    form.audience === "both"
      ? "Both"
      : form.audience === "student"
        ? "Student"
        : "Instructor";
  const downloadHref = `/api/forms/download?file=${encodeURIComponent(form.fileName)}&name=${encodeURIComponent(form.fileName)}`;

  return (
    <div className="surface-section flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--ink-strong)]">{form.title}</p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{form.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-[var(--accent-secondary)] transition-colors hover:opacity-80"
          >
            Open form
          </a>
          <span className="text-xs text-[var(--ink-muted)]">{form.fileName}</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {form.fillable && (
          <span className="rounded-full bg-[var(--accent-secondary)]/15 px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-secondary)]">
            Fillable
          </span>
        )}
        {form.required && (
          <span className="rounded-full bg-[var(--accent-strong)]/15 px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">
            Required
          </span>
        )}
        <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2.5 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
          {audienceLabel}
        </span>
      </div>

      {form.audience !== "instructor" && (
        <div className="flex shrink-0 items-center">
          <FormUploadButton
            formId={form.id}
            currentStatus={submissionStatus as "pending" | "approved" | "rejected" | null}
            onUploadComplete={onUploadComplete}
          />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-3 sm:hidden">
        <p className="text-xs text-[var(--ink-muted)]">
          Ask your instructor for this form
        </p>
        <Link
          href={`/chat?topic=form&name=${encodeURIComponent(form.title)}`}
          prefetch={false}
          className="text-sm font-semibold text-[var(--accent-secondary)] transition-colors hover:opacity-80"
        >
          Ask Sage →
        </Link>
      </div>

      {/* Desktop bottom row — rendered inside flex-row context */}
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <p className="text-xs text-[var(--ink-muted)]">
          Ask your instructor for this form
        </p>
        <Link
          href={`/chat?topic=form&name=${encodeURIComponent(form.title)}`}
          prefetch={false}
          className="text-sm font-semibold text-[var(--accent-secondary)] transition-colors hover:opacity-80"
        >
          Ask Sage →
        </Link>
      </div>
    </div>
  );
}
