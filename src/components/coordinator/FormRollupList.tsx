"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

interface TemplateRow {
  id: string;
  title: string;
  status: "active" | "archived";
  isOfficial: boolean;
  responseCount: number;
  assignmentCount: number;
}

export default function FormRollupList() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ templates: TemplateRow[] }>("/api/teacher/forms/templates")
      .then((data) => {
        if (!cancelled) {
          setTemplates(data.templates.filter((template) => template.status === "active"));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load form templates.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="surface-section p-5">
      <header className="mb-4">
        <h2 className="font-display text-xl text-[var(--ink-strong)]">Forms</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Active templates with response counts and CSV export links for funder reporting.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {templates === null ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No active templates yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[var(--ink-strong)]">{template.title}</p>
                  {template.isOfficial && (
                    <span className="rounded-full bg-[var(--badge-info-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--badge-info-text)]">
                      Official
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--ink-muted)]">
                  {template.responseCount} response{template.responseCount === 1 ? "" : "s"} ·{" "}
                  {template.assignmentCount} assignment{template.assignmentCount === 1 ? "" : "s"}
                </p>
              </div>
              <a
                href={`/api/teacher/forms/${template.id}/export`}
                download
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)]"
              >
                CSV
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
