"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Warning } from "@phosphor-icons/react";

import { api } from "@/lib/api";

interface AssignedFormEntry {
  assignmentId: string;
  templateId: string;
  title: string;
  description: string | null;
  isOfficial: boolean;
  dueAt: string | null;
  requiredForCompletion: boolean;
  scope: "class" | "student";
  response: {
    id: string;
    status: "draft" | "submitted" | "reviewed" | "needs_changes";
    submittedAt: string | null;
    reviewerNotes: string | null;
  } | null;
}

const STATUS_LABEL: Record<NonNullable<AssignedFormEntry["response"]>["status"], string> = {
  draft: "In progress",
  submitted: "Submitted",
  reviewed: "Reviewed",
  needs_changes: "Needs changes",
};

function statusFor(entry: AssignedFormEntry): { label: string; tone: "neutral" | "warn" | "ok" } {
  if (!entry.response) return { label: "Not started", tone: "neutral" };
  if (entry.response.status === "needs_changes") return { label: STATUS_LABEL.needs_changes, tone: "warn" };
  if (entry.response.status === "reviewed") return { label: STATUS_LABEL.reviewed, tone: "ok" };
  if (entry.response.status === "submitted") return { label: STATUS_LABEL.submitted, tone: "ok" };
  return { label: STATUS_LABEL.draft, tone: "warn" };
}

function isActionable(entry: AssignedFormEntry): boolean {
  if (!entry.response) return true;
  return entry.response.status === "draft" || entry.response.status === "needs_changes";
}

export default function AssignedFormsCard() {
  const [forms, setForms] = useState<AssignedFormEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ forms: AssignedFormEntry[] }>("/api/student/forms")
      .then((data) => {
        if (!cancelled) setForms(data.forms);
      })
      .catch(() => {
        if (!cancelled) setForms([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (forms === null) return null;
  if (forms.length === 0) return null;

  const actionable = forms.filter(isActionable).slice(0, 3);
  const hasMore = forms.length > actionable.length;
  const visible = actionable.length > 0 ? actionable : forms.slice(0, 3);

  return (
    <div className="surface-section p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            Paperwork
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Forms your program needs from you.
          </p>
        </div>
        <Link
          href="/forms"
          prefetch={false}
          className="text-sm font-semibold text-[var(--accent-green)]"
        >
          See all
        </Link>
      </div>

      <ul className="space-y-2">
        {visible.map((entry) => {
          const tone = statusFor(entry);
          return (
            <li key={entry.assignmentId}>
              <Link
                href={`/forms/${entry.templateId}`}
                prefetch={false}
                className="flex items-center gap-3 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 transition-transform hover:-translate-y-0.5"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--ink-muted)]">
                  {tone.tone === "warn" ? (
                    <Warning size={18} weight="duotone" />
                  ) : (
                    <FileText size={18} weight="duotone" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--ink-strong)]">{entry.title}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {tone.label}
                    {entry.dueAt ? ` · due ${new Date(entry.dueAt).toLocaleDateString()}` : ""}
                    {entry.requiredForCompletion ? " · required" : ""}
                  </p>
                </div>
                <ArrowRight size={18} weight="bold" className="shrink-0 text-[var(--ink-faint)]" />
              </Link>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <p className="mt-2 text-xs text-[var(--ink-faint)]">
          +{forms.length - visible.length} more on{" "}
          <Link href="/forms" prefetch={false} className="underline">
            /forms
          </Link>
        </p>
      )}
    </div>
  );
}
