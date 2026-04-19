interface InstructorMetricsRow {
  instructor: { id: string; studentId: string; displayName: string; email: string | null };
  activeStudents: number;
  alertResponseDays: number | null;
  certPassRate: number | null;
  formCompletionRate: number | null;
  classCount: number;
}

export default function InstructorGrid({ metrics }: { metrics: InstructorMetricsRow[] }) {
  return (
    <section className="surface-section p-5">
      <header className="mb-4">
        <h2 className="font-display text-xl text-[var(--ink-strong)]">Instructors</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Active students, certification pass rate, form completion, and alert response time per instructor in this region.
        </p>
      </header>

      {metrics.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No instructors assigned to classes in this region yet.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {metrics.map((row) => (
            <article
              key={row.instructor.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-2"
            >
              <header>
                <p className="font-semibold text-[var(--ink-strong)]">{row.instructor.displayName}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {row.classCount} class{row.classCount === 1 ? "" : "es"}
                </p>
              </header>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Metric label="Active students" value={row.activeStudents} />
                <Metric label="Cert pass rate" value={formatRate(row.certPassRate)} />
                <Metric label="Form completion" value={formatRate(row.formCompletionRate)} />
                <Metric
                  label="Alert response"
                  value={row.alertResponseDays === null ? "—" : `${row.alertResponseDays}d`}
                />
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-raised)] p-2">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{label}</dt>
      <dd className="mt-1 font-display text-lg text-[var(--ink-strong)]">{value}</dd>
    </div>
  );
}

function formatRate(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}
