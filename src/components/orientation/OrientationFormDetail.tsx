"use client";

import FormUploadButton from "@/components/ui/FormUploadButton";
import { getOrientationStepDetail } from "@/lib/orientation-step-resources";
import {
  buildFormDownloadUrl,
  hasDownloadableFormDocument,
  type SpokesForm,
} from "@/lib/spokes/forms";

function OrientationFormCard({
  form,
  currentStatus,
  onUploadComplete,
}: {
  form: SpokesForm;
  currentStatus: "pending" | "approved" | "rejected" | null;
  onUploadComplete?: () => void;
}) {
  const hasDocument = hasDownloadableFormDocument(form);

  return (
    <div className="rounded-xl border border-[rgba(15,154,146,0.12)] bg-[rgba(15,154,146,0.06)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[var(--ink-strong)]">{form.title}</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{form.description}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {form.fillable && (
            <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-secondary)]">
              Fillable
            </span>
          )}
          {form.required && (
            <span className="rounded-full bg-[rgba(249,115,22,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-strong)]">
              Required
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {hasDocument ? (
          <>
            <a
              href={buildFormDownloadUrl(form, "view")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:opacity-80"
            >
              Open PDF
            </a>
            <a
              href={buildFormDownloadUrl(form, "download")}
              className="text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
            >
              Download
            </a>
          </>
        ) : (
          <p className="text-xs text-[var(--accent-strong)]">
            PDF not connected yet. You can still upload a completed copy if your class uses paper forms.
          </p>
        )}

        {form.acceptsSubmission && (
          <FormUploadButton
            formId={form.id}
            currentStatus={currentStatus}
            onUploadComplete={onUploadComplete}
          />
        )}
      </div>
    </div>
  );
}

export function findRelatedForms(itemLabel: string): SpokesForm[] {
  return getOrientationStepDetail(itemLabel).forms;
}

interface OrientationFormDetailProps {
  itemLabel: string;
  formStatuses?: Record<string, string>;
  onUploadComplete?: () => void;
}

export default function OrientationFormDetail({
  itemLabel,
  formStatuses,
  onUploadComplete,
}: OrientationFormDetailProps) {
  const detail = getOrientationStepDetail(itemLabel);

  if (detail.forms.length === 0 && !detail.note) {
    return null;
  }

  return (
    <div className="ml-7 mt-2 space-y-2">
      {detail.note && (
        <div className="rounded-xl border border-[rgba(16,37,62,0.08)] bg-[rgba(16,37,62,0.03)] p-3">
          <p className="text-xs font-semibold text-[var(--ink-strong)]">Step guidance</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{detail.note}</p>
        </div>
      )}

      {detail.forms.map((form) => (
        <OrientationFormCard
          key={form.id}
          form={form}
          currentStatus={(formStatuses?.[form.id] ?? null) as "pending" | "approved" | "rejected" | null}
          onUploadComplete={onUploadComplete}
        />
      ))}
    </div>
  );
}
