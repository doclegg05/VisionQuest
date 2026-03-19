"use client";

import Link from "next/link";
import { useState } from "react";
import { FORMS, type SpokesForm } from "@/lib/spokes/forms";
import FormUploadButton from "@/components/ui/FormUploadButton";

// Map orientation item labels to form IDs from the static data
const ITEM_FORM_MAP: Record<string, string[]> = {
  "welcome letter": ["welcome-letter"],
  "student profile": ["student-profile"],
  "attendance contract": ["attendance-contract"],
  "rights and responsibilities": ["rights-responsibilities"],
  "dress code": ["dress-code"],
  "release of information": ["release-of-info", "dohs-release"],
  "media release": ["media-release"],
  "technology": ["tech-acceptable-use"],
  "acceptable use": ["tech-acceptable-use"],
  "portfolio checklist": ["portfolio-checklist"],
  "learning needs": ["learning-needs"],
  "learning styles": ["learning-styles"],
  "non-discrimination": ["non-discrimination"],
  "password": ["password-log"],
  "career exploration": ["career-worksheet"],
  "sign-in": ["sign-in-sheet"],
};

function findRelatedForms(itemLabel: string): SpokesForm[] {
  const labelLower = itemLabel.toLowerCase();
  const matchedIds = new Set<string>();

  for (const [keyword, formIds] of Object.entries(ITEM_FORM_MAP)) {
    if (labelLower.includes(keyword)) {
      formIds.forEach(id => matchedIds.add(id));
    }
  }

  return FORMS.filter(f => matchedIds.has(f.id));
}

interface OrientationFormDetailProps {
  itemLabel: string;
  formStatuses?: Record<string, string>;
  onUploadComplete?: () => void;
}

function FormActions({ form }: { form: SpokesForm }) {
  const [downloading, setDownloading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const downloadUrl = `/api/forms/download?file=${encodeURIComponent(form.fileName)}&name=${encodeURIComponent(form.fileName)}`;
  const viewUrl = `/api/forms/download?file=${encodeURIComponent(form.fileName)}&name=${encodeURIComponent(form.fileName)}`;

  async function handleDownload() {
    setDownloading(true);
    setNotFound(false);
    try {
      const res = await fetch(downloadUrl);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = form.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotFound(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-2 flex-wrap">
        {/* View in browser */}
        <a
          href={viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg bg-[rgba(15,154,146,0.1)] border border-[rgba(15,154,146,0.2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-secondary)] hover:bg-[rgba(15,154,146,0.18)] transition-colors"
        >
          <span>👁</span> View
        </a>

        {/* Download to device */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1 rounded-lg bg-[rgba(15,154,146,0.1)] border border-[rgba(15,154,146,0.2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-secondary)] hover:bg-[rgba(15,154,146,0.18)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>⬇</span> {downloading ? "Downloading…" : "Download"}
        </button>

        {/* Ask Sage */}
        <Link
          href={`/chat?topic=form&name=${encodeURIComponent(form.title)}`}
          prefetch={false}
          className="text-[10px] font-semibold text-[var(--accent-secondary)] hover:underline ml-auto"
        >
          Ask Sage →
        </Link>
      </div>

      {/* File not yet uploaded message */}
      {notFound && (
        <p className="text-[10px] text-amber-500 font-medium mt-0.5">
          ⚠ This document hasn&apos;t been uploaded yet — ask your instructor for a copy.
        </p>
      )}
    </div>
  );
}

export default function OrientationFormDetail({ itemLabel, formStatuses, onUploadComplete }: OrientationFormDetailProps) {
  const relatedForms = findRelatedForms(itemLabel);

  if (relatedForms.length === 0) return null;

  return (
    <div className="mt-2 ml-7 space-y-2">
      {relatedForms.map(form => (
        <div key={form.id} className="rounded-xl bg-[rgba(15,154,146,0.06)] border border-[rgba(15,154,146,0.12)] p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--ink-strong)]">{form.title}</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">{form.description}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
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

          <div className="mt-2 space-y-2">
            {/* Download / View actions */}
            <FormActions form={form} />

            {/* Upload completed form back (for student-facing forms) */}
            {form.audience !== "instructor" && (
              <FormUploadButton
                formId={form.id}
                currentStatus={(formStatuses?.[form.id] ?? null) as "pending" | "approved" | "rejected" | null}
                onUploadComplete={onUploadComplete}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
