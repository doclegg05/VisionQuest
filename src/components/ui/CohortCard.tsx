"use client";

interface CohortCardProps {
  className: string;
  classmateCount: number;
  avgOrientationPct: number;
  orientationCompletedThisWeek: number;
  avgReadinessScore: number;
}

export function CohortCard({
  className: classLabel,
  classmateCount,
  avgOrientationPct,
  orientationCompletedThisWeek,
  avgReadinessScore,
}: CohortCardProps) {
  return (
    <div className="surface-section p-5 md:col-span-2">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">👥</span>
        <h3 className="text-sm font-medium text-[var(--ink-muted)]">
          Your Class: {classLabel}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={classmateCount} label="classmates" />
        <Stat value={`${avgOrientationPct}%`} label="avg orientation" />
        <Stat value={orientationCompletedThisWeek} label="finished this week" />
        <Stat value={`${avgReadinessScore}%`} label="avg readiness" />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="font-display text-2xl font-bold text-[var(--ink-strong)]">{value}</p>
      <p className="text-xs text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

export default CohortCard;
