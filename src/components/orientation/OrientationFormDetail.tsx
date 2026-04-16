"use client";

import { useState } from "react";
import FormUploadButton from "@/components/ui/FormUploadButton";
import SignaturePad from "@/components/ui/SignaturePad";
import { getOrientationStepDetail } from "@/lib/orientation-step-resources";
import {
  buildFormDownloadUrl,
  hasDownloadableFormDocument,
  type SpokesForm,
} from "@/lib/spokes/forms";

function SignAndSubmitButton({
  formId,
  currentStatus,
  onComplete,
  targetStudentId,
}: {
  formId: string;
  currentStatus: "pending" | "approved" | "rejected" | null;
  onComplete?: () => void;
  targetStudentId?: string;
}) {
  const [showPad, setShowPad] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSign(dataUrl: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/forms/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, signature: dataUrl, studentId: targetStudentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Signature submission failed.");
        return;
      }
      setShowPad(false);
      onComplete?.();
    } catch {
      setError("Signature submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (currentStatus === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        Signed & Approved
      </span>
    );
  }

  if (currentStatus === "pending") {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          Signed — Pending Review
        </span>
        <button
          onClick={() => setShowPad(true)}
          type="button"
          className="text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          Re-sign
        </button>
      </div>
    );
  }

  if (showPad) {
    return (
      <div className="mt-2">
        {submitting && (
          <p className="mb-2 text-xs text-[var(--ink-muted)]">Submitting signature...</p>
        )}
        <SignaturePad
          onSign={handleSign}
          onCancel={() => setShowPad(false)}
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setShowPad(true)}
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,154,146,0.2)] bg-[rgba(15,154,146,0.06)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(15,154,146,0.12)]"
      >
        {currentStatus === "rejected" ? "Re-sign" : "Sign & Submit"}
      </button>
      {currentStatus === "rejected" && (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
          Returned — please re-sign
        </span>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function OrientationFormCard({
  form,
  currentStatus,
  onUploadComplete,
  targetStudentId,
}: {
  form: SpokesForm;
  currentStatus: "pending" | "approved" | "rejected" | null;
  onUploadComplete?: () => void;
  targetStudentId?: string;
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
            <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-secondary)]">
              Fillable
            </span>
          )}
          {form.requiresSignature && (
            <span className="rounded-full bg-[rgba(99,102,241,0.1)] px-2 py-0.5 text-xs font-semibold text-indigo-600">
              Signature
            </span>
          )}
          {form.required && (
            <span className="rounded-full bg-[rgba(249,115,22,0.1)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">
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
      </div>

      {/* Submission actions */}
      <div className="mt-2">
        {form.requiresSignature ? (
          <SignAndSubmitButton
            formId={form.id}
            currentStatus={currentStatus}
            onComplete={onUploadComplete}
            targetStudentId={targetStudentId}
          />
        ) : form.acceptsSubmission ? (
          <FormUploadButton
            formId={form.id}
            currentStatus={currentStatus}
            onUploadComplete={onUploadComplete}
            targetStudentId={targetStudentId}
          />
        ) : null}
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
  targetStudentId?: string;
}

export default function OrientationFormDetail({
  itemLabel,
  formStatuses,
  onUploadComplete,
  targetStudentId,
}: OrientationFormDetailProps) {
  const detail = getOrientationStepDetail(itemLabel);

  if (detail.forms.length === 0 && !detail.note) {
    return null;
  }

  return (
    <div className="ml-7 mt-2 space-y-2">
      {detail.note && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
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
          targetStudentId={targetStudentId}
        />
      ))}
    </div>
  );
}
