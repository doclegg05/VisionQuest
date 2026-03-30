interface ChecklistTemplate {
  id: string;
  label: string;
  description: string | null;
  category: string;
  required: boolean;
}

interface ChecklistProgress {
  templateId: string;
  completed: boolean;
  completedAt: string | null;
}

interface ModuleTemplate {
  id: string;
  label: string;
  description: string | null;
}

interface ModuleProgress {
  templateId: string;
  completedAt: string;
}

interface FollowUpScheduleItem {
  checkpointMonths: number;
  dueAt: string | null;
  status: "not_applicable" | "upcoming" | "due" | "completed";
  completed: boolean;
  followUp: {
    checkedAt: string;
    status: string;
    notes: string | null;
  } | null;
}

interface StudentSpokesHubProps {
  record: {
    status: string;
    referralDate: string | null;
    enrolledAt: string | null;
    familySurveyOfferedAt: string | null;
    postSecondaryEnteredAt: string | null;
    unsubsidizedEmploymentAt: string | null;
    postSecondaryProgram: string | null;
    employerName: string | null;
  } | null;
  summary: {
    orientation: { done: number; total: number };
    programFiles: { done: number; total: number };
    modules: { done: number; total: number };
    employmentFollowUpsDue: number;
    employmentFollowUpSchedule: FollowUpScheduleItem[];
  };
  checklistTemplates: ChecklistTemplate[];
  checklistProgress: ChecklistProgress[];
  moduleTemplates: ModuleTemplate[];
  moduleProgress: ModuleProgress[];
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function StudentSpokesHub({
  record,
  summary,
  checklistTemplates,
  checklistProgress,
  moduleTemplates,
  moduleProgress,
}: StudentSpokesHubProps) {
  const orientationTemplates = checklistTemplates.filter((template) => template.category === "orientation");
  const programFileTemplates = checklistTemplates.filter((template) => template.category === "program_file");

  function renderChecklist(title: string, templates: ChecklistTemplate[]) {
    return (
      <div className="rounded-[1.25rem] border border-[var(--border-soft)] bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)]">{title}</h3>
        <div className="mt-3 space-y-2">
          {templates.map((template) => {
            const progress = checklistProgress.find((item) => item.templateId === template.id);

            return (
              <div
                key={template.id}
                className={`rounded-xl border p-3 ${
                  progress?.completed
                    ? "border-emerald-200 bg-emerald-50/80"
                    : "border-[var(--border-soft)] bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--ink-strong)]">
                      {template.label}
                      {template.required ? <span className="ml-1 text-xs text-rose-500">*</span> : null}
                    </p>
                    {template.description ? (
                      <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{template.description}</p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      progress?.completed
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {progress?.completed ? "Complete" : "Pending"}
                  </span>
                </div>
              </div>
            );
          })}
          {templates.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Your teachers have not published items here yet.</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Official status</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">
            {record ? record.status.replaceAll("_", " ") : "Awaiting setup"}
          </p>
        </div>
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Orientation</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">
            {summary.orientation.done}/{summary.orientation.total}
          </p>
        </div>
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Program files</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">
            {summary.programFiles.done}/{summary.programFiles.total}
          </p>
        </div>
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Required modules</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">
            {summary.modules.done}/{summary.modules.total}
          </p>
        </div>
      </div>

      {!record ? (
        <div className="surface-section p-6">
          <p className="text-sm leading-6 text-[var(--ink-muted)]">
            Your official SPOKES record has not been set up in VisionQuest yet. Your instructor can publish it here
            once referral and program paperwork are ready.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="surface-section p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Milestones</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Where you are in the SPOKES process</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">Referral logged</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">{formatDate(record.referralDate)}</p>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">Enrollment</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">{formatDate(record.enrolledAt)}</p>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">WV Family Survey</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">{formatDate(record.familySurveyOfferedAt)}</p>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">Post-secondary</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">
                    {record.postSecondaryEnteredAt
                      ? `${formatDate(record.postSecondaryEnteredAt)}${record.postSecondaryProgram ? ` • ${record.postSecondaryProgram}` : ""}`
                      : "Not recorded yet"}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4 sm:col-span-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">Employment follow-up</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">
                    {record.unsubsidizedEmploymentAt
                      ? `${formatDate(record.unsubsidizedEmploymentAt)}${record.employerName ? ` • ${record.employerName}` : ""}`
                      : "Your teacher will add follow-up dates here if employment is recorded."}
                  </p>
                </div>
              </div>
            </section>

            <section className="surface-section p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Modules</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Required modules</h2>
              <div className="mt-5 space-y-3">
                {moduleTemplates.map((template) => {
                  const progress = moduleProgress.find((item) => item.templateId === template.id);

                  return (
                    <div key={template.id} className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-[var(--ink-strong)]">{template.label}</p>
                          {template.description ? (
                            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{template.description}</p>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                            progress
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {progress ? `Completed ${formatDate(progress.completedAt)}` : "Pending"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {moduleTemplates.length === 0 ? (
                  <p className="text-sm text-[var(--ink-muted)]">No SPOKES modules are published yet.</p>
                ) : null}
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="surface-section p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Paperwork</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Orientation and files</h2>
              <div className="mt-5 space-y-4">
                {renderChecklist("Orientation items", orientationTemplates)}
                {renderChecklist("Program files", programFileTemplates)}
              </div>
            </section>

            <section className="surface-section p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Follow-up</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Employment checkpoints</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                Your teachers will log the 1-, 3-, and 6-month check-ins here after unsubsidized employment.
                {summary.employmentFollowUpsDue > 0 ? ` ${summary.employmentFollowUpsDue} check-in(s) are due.` : ""}
              </p>
              <div className="mt-5 space-y-3">
                {summary.employmentFollowUpSchedule.map((item) => (
                  <div key={item.checkpointMonths} className="rounded-xl border border-[var(--border-soft)] bg-white/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--ink-strong)]">{item.checkpointMonths}-month follow-up</p>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {item.dueAt ? `Due ${formatDate(item.dueAt)}` : "Will appear after employment is recorded"}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                          item.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : item.status === "due"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    {item.followUp ? (
                      <p className="mt-3 text-sm text-[var(--ink-muted)]">
                        {formatDate(item.followUp.checkedAt)} • {item.followUp.status}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
