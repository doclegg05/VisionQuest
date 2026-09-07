"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

interface TemplateRow {
  templateId: string;
  title: string;
  isOfficial: boolean;
  assignmentCount: number;
  responseCount: number;
  completionRate: number | null;
}

interface RollupResponse {
  rollup: {
    regionId: string;
    classCount: number;
    studentCount: number;
    templates: TemplateRow[];
  };
  /**
   * Whether THIS session can actually reach /api/teacher/forms/[id]/export.
   * Answered by the server from the export route's own gates, so the link
   * below cannot outlive them. Coordinators get `false` — the panel used to
   * render the link for everyone and 403 them on click (C7).
   */
  canExport: boolean;
}

export default function FormRollupList({ regionId }: { regionId: string }) {
  const [data, setData] = useState<RollupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adjust-during-render rather than a setState inside the effect, so a
  // region switch clears the previous region's counts in the same render pass
  // instead of briefly showing them under the new region's name. Same pattern
  // as CoordinatorDashboardClient's own region tracking.
  const [trackedRegionId, setTrackedRegionId] = useState(regionId);
  if (trackedRegionId !== regionId) {
    setTrackedRegionId(regionId);
    setData(null);
    setError(null);
  }

  useEffect(() => {
    if (!regionId) return;
    let cancelled = false;
    api
      .get<RollupResponse>(`/api/coordinator/forms/${regionId}`)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load form templates.");
      });
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  const templates = data?.rollup.templates ?? null;

  return (
    <section className="surface-section p-5">
      <header className="mb-4">
        <h2 className="font-display text-xl text-[var(--ink-strong)]">Forms</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Active templates with response counts for the classes in this region.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {templates === null ? (
        !error && <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          {data && data.rollup.classCount === 0
            ? "No classes in this region yet, so there are no form responses to count."
            : "No active templates yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li
              key={template.templateId}
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
                  {template.responseCount} response{template.responseCount === 1 ? "" : "s"} from{" "}
                  {data?.rollup.studentCount ?? 0} student
                  {data?.rollup.studentCount === 1 ? "" : "s"} in this region ·{" "}
                  {template.assignmentCount} assignment{template.assignmentCount === 1 ? "" : "s"}
                </p>
              </div>
              {data?.canExport && (
                <a
                  href={`/api/teacher/forms/${template.templateId}/export`}
                  download
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)]"
                >
                  CSV
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
