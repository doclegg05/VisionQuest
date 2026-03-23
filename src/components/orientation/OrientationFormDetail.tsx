"use client";

import { FORMS, type SpokesForm } from "@/lib/spokes/forms";
import FormUploadButton from "@/components/ui/FormUploadButton";

// Map orientation item labels to form IDs from the static data.
// Keys are lowercase substrings matched against the item label.
const ITEM_FORM_MAP: Record<string, string[]> = {
  "welcome letter": ["welcome-letter"],
  "program overview": ["welcome-letter"],
  "student profile": ["student-profile"],
  "attendance contract": ["attendance-contract"],
  "attendance and closing": ["attendance-contract"],
  "closing policy": ["attendance-contract"],
  "rights and responsibilities": ["rights-responsibilities"],
  "dress code": ["dress-code"],
  "release of information": ["auth-release", "dohs-release"],
  "media release": ["media-release"],
  "technology acceptable use": ["tech-acceptable-use"],
  "acceptable use": ["tech-acceptable-use"],
  "portfolio checklist": ["portfolio-checklist"],
  "learning needs": ["learning-needs"],
  "learning styles": ["learning-styles"],
  "non-discrimination": ["non-discrimination"],
  "sign-in": ["sign-in-sheet"],
  "time sheet": ["dfa-ts-12"],
  "dohs participant": ["dfa-ts-12"],
  "module record": ["spokes-module-record"],
  "ready to work": ["rtw-attendance"],
  "attendance verification": ["rtw-attendance"],
};

export function findRelatedForms(itemLabel: string): SpokesForm[] {
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

export default function OrientationFormDetail({ itemLabel, formStatuses, onUploadComplete }: OrientationFormDetailProps) {
  const relatedForms = findRelatedForms(itemLabel);

  if (relatedForms.length === 0) return null;

  return (
    <div className="mt-2 ml-7 space-y-2">
      {relatedForms.map(form => {
        const downloadHref = `/api/forms/download?file=${encodeURIComponent(form.fileName)}&name=${encodeURIComponent(form.fileName)}`;

        return (
          <div key={form.id} className="rounded-xl bg-[rgba(15,154,146,0.06)] border border-[rgba(15,154,146,0.12)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--ink-strong)]">{form.title}</p>
                <p className="text-xs text-[var(--ink-muted)] mt-0.5">{form.description}</p>
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

            <div className="mt-2 flex items-center gap-3">
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:opacity-80"
              >
                View PDF
              </a>
              {form.audience !== "instructor" && (
                <FormUploadButton
                  formId={form.id}
                  currentStatus={(formStatuses?.[form.id] ?? null) as "pending" | "approved" | "rejected" | null}
                  onUploadComplete={onUploadComplete}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
