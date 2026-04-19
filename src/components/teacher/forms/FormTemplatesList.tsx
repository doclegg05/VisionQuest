"use client";

import { useCallback, useEffect, useState } from "react";

import { api, apiFetch } from "@/lib/api";

import FormBuilder from "./FormBuilder";

interface TemplateSummary {
  id: string;
  title: string;
  description: string | null;
  programTypes: string[];
  status: "active" | "archived";
  isOfficial: boolean;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
  assignmentCount: number;
}

interface TemplatesResponse {
  templates: TemplateSummary[];
}

type BuilderState =
  | { mode: "closed" }
  | { mode: "new" }
  | { mode: "edit"; templateId: string };

export default function FormTemplatesList() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [builder, setBuilder] = useState<BuilderState>({ mode: "closed" });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<TemplatesResponse>(
        includeArchived ? "/api/teacher/forms/templates?includeArchived=true" : "/api/teacher/forms/templates",
      );
      setTemplates(data.templates);
    } catch {
      setError("Failed to load form templates.");
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  async function handleArchive(templateId: string) {
    try {
      const res = await apiFetch(`/api/teacher/forms/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("archive failed");
      await fetchTemplates();
    } catch {
      setError("Could not archive the template.");
    }
  }

  async function handleReactivate(templateId: string) {
    try {
      const res = await apiFetch(`/api/teacher/forms/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error("reactivate failed");
      await fetchTemplates();
    } catch {
      setError("Could not reactivate the template.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Show archived
        </label>
        <button
          type="button"
          onClick={() => setBuilder({ mode: "new" })}
          className="primary-button px-4 py-2 text-sm"
        >
          New form
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No form templates yet. Click <strong>New form</strong> to create one.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-[var(--ink-strong)]">{template.title}</h4>
                  {template.isOfficial && (
                    <span className="rounded-full bg-[var(--badge-info-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--badge-info-text)]">
                      Official
                    </span>
                  )}
                  {template.status === "archived" && (
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--ink-muted)]">
                      Archived
                    </span>
                  )}
                  {template.programTypes.length > 0 && (
                    <span className="text-xs text-[var(--ink-muted)]">
                      {template.programTypes.join(", ")}
                    </span>
                  )}
                </div>
                {template.description && (
                  <p className="mt-1 text-sm text-[var(--ink-muted)] truncate">{template.description}</p>
                )}
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {template.responseCount} response{template.responseCount === 1 ? "" : "s"} ·{" "}
                  {template.assignmentCount} assignment{template.assignmentCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setBuilder({ mode: "edit", templateId: template.id })}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)]"
                >
                  Edit
                </button>
                {template.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => void handleArchive(template.id)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)]"
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleReactivate(template.id)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)]"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {builder.mode !== "closed" && (
        <FormBuilder
          mode={builder.mode}
          templateId={builder.mode === "edit" ? builder.templateId : undefined}
          onClose={() => setBuilder({ mode: "closed" })}
          onSaved={() => {
            setBuilder({ mode: "closed" });
            void fetchTemplates();
          }}
        />
      )}
    </div>
  );
}
