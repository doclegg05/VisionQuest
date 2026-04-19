interface HeadlineMetrics {
  activeStudents: number;
  enrollmentsInPeriod: number;
  certificationsInPeriod: number;
  placementsInPeriod: number;
  gedEarnedInPeriod: number;
}

interface RegionRollupCardProps {
  rollup: {
    regionName: string;
    periodStart: string;
    periodEnd: string;
    headline: HeadlineMetrics;
    classCount: number;
  };
}

const METRIC_ROWS: Array<{ key: keyof HeadlineMetrics; label: string }> = [
  { key: "activeStudents", label: "Active students" },
  { key: "enrollmentsInPeriod", label: "New enrollments" },
  { key: "certificationsInPeriod", label: "Certifications" },
  { key: "placementsInPeriod", label: "Placements" },
  { key: "gedEarnedInPeriod", label: "GED earned" },
];

export default function RegionRollupCard({ rollup }: RegionRollupCardProps) {
  const periodStart = new Date(rollup.periodStart).toLocaleDateString();
  const periodEnd = new Date(rollup.periodEnd).toLocaleDateString();

  return (
    <section className="surface-section p-5">
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">{rollup.regionName}</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {periodStart} – {periodEnd} · {rollup.classCount} active class{rollup.classCount === 1 ? "" : "es"}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {METRIC_ROWS.map((row) => (
          <div
            key={row.key}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"
          >
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {row.label}
            </dt>
            <dd className="mt-2 font-display text-2xl text-[var(--ink-strong)]">
              {rollup.headline[row.key]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
