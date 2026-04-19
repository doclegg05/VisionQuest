import Link from "next/link";

import { getSession } from "@/lib/auth";
import PageIntro from "@/components/ui/PageIntro";
import { listAssignedForms } from "@/lib/forms/assignment";

export default async function StudentFormsPage() {
  const session = await getSession();
  if (!session || session.role !== "student") return null;

  const forms = await listAssignedForms(session.id);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Program paperwork"
        title="Forms"
        description="Everything your program needs you to fill out, in one place."
      />

      {forms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--ink-muted)]">
          No forms assigned to you right now. When your instructor assigns one, it will show up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {forms.map((form) => {
            const status = form.response?.status ?? "not_started";
            const statusLabel =
              status === "needs_changes"
                ? "Needs changes"
                : status === "reviewed"
                  ? "Reviewed"
                  : status === "submitted"
                    ? "Submitted"
                    : status === "draft"
                      ? "In progress"
                      : "Not started";
            const actionable = status === "not_started" || status === "draft" || status === "needs_changes";

            return (
              <li key={form.assignmentId}>
                <Link
                  href={`/forms/${form.templateId}`}
                  prefetch={false}
                  className="flex items-start gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4 transition-transform hover:-translate-y-0.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-[var(--ink-strong)]">{form.title}</h3>
                      {form.requiredForCompletion && (
                        <span className="rounded-full bg-[var(--badge-warning-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--badge-warning-text)]">
                          Required
                        </span>
                      )}
                      {form.isOfficial && (
                        <span className="rounded-full bg-[var(--badge-info-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--badge-info-text)]">
                          Official
                        </span>
                      )}
                    </div>
                    {form.description && (
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{form.description}</p>
                    )}
                    <p className="mt-2 text-xs text-[var(--ink-faint)]">
                      {statusLabel}
                      {form.dueAt ? ` · due ${new Date(form.dueAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  {actionable && (
                    <span className="shrink-0 rounded-full border border-[var(--accent-green)] px-3 py-1 text-xs font-semibold text-[var(--accent-green)]">
                      Open
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
