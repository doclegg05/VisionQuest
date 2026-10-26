"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Payload interfaces
// ---------------------------------------------------------------------------

interface ReadinessSummary {
  totalStudents: number;
  averageReadiness: number;
  medianReadiness: number;
  studentsAbove50: number;
  studentsAbove75: number;
  totalGoals: number;
  totalCompleted: number;
  totalConfirmed: number;
  pathwayCoverage: {
    eligibleGoals: number;
    goalsWithPathway: number;
    coverageRate: number;
  };
  requirementCompliance: {
    totalStudents: number;
    compliantStudents: number;
    complianceRate: number;
    totalRequired: number;
    averageMet: number;
  } | null;
}

interface ReadinessPayload {
  month: string;
  snapshotType: string;
  summary: ReadinessSummary;
}

interface MonthlyKpiDashboardProps {
  classId?: string;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="theme-card rounded-2xl p-5 animate-pulse">
      <div className="h-3 w-24 rounded bg-[var(--surface-interactive)] mb-3" />
      <div className="h-7 w-16 rounded bg-[var(--surface-interactive)] mb-2" />
      <div className="h-3 w-32 rounded bg-[var(--surface-interactive)]" />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}

function StatCard({ label, value, sub, tone = "text-[var(--ink-strong)]" }: StatCardProps) {
  return (
    <div className="theme-card rounded-2xl p-5">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--ink-muted)]">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar row
// ---------------------------------------------------------------------------

interface ProgressRowProps {
  label: string;
  value: number;
  max: number;
  color?: string;
}

function ProgressRow({ label, value, max, color = "bg-[linear-gradient(90deg,var(--accent-secondary),var(--accent-strong))]" }: ProgressRowProps) {
  const pct = max > 0 ? Math.min(100, Math.max((value / max) * 100, 4)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm mb-1.5">
        <span className="text-[var(--ink-muted)]">{label}</span>
        <span className="font-semibold text-[var(--ink-strong)]">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--surface-interactive)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

interface QuickActionsProps {
  classId?: string;
}

function QuickActions({ classId }: QuickActionsProps) {
  const classParam = classId ? `?classId=${classId}` : "";

  const actions = [
    {
      label: "Full Readiness Report",
      href: `/teacher/manage?tab=reports`,
      description: "View per-student readiness breakdown",
      icon: "📊",
    },
    {
      label: "Intervention Queue",
      href: `/teacher`,
      description: "Students who may need a touchpoint",
      icon: "🎯",
    },
    ...(classId
      ? [
          {
            label: "Unmatched Goals",
            href: `/teacher/manage?tab=learning${classParam}`,
            description: "Goals without a pathway assigned",
            icon: "🔗",
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {actions.map((action) => (
        <a
          key={action.label}
          href={action.href}
          className="theme-card rounded-2xl p-4 transition-shadow hover:shadow-md flex items-start gap-3"
        >
          <span className="text-xl flex-shrink-0 mt-0.5">{action.icon}</span>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-strong)]">{action.label}</p>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{action.description}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MonthlyKpiDashboard({ classId }: MonthlyKpiDashboardProps) {
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const classParam = classId ? `?classId=${classId}` : "";
      const readinessRes = await fetch(`/api/teacher/reports/readiness-monthly${classParam}`);

      const readinessPayload = await readinessRes.json().catch(() => null);
      if (!readinessRes.ok) {
        throw new Error(
          readinessPayload && typeof readinessPayload.error === "string"
            ? readinessPayload.error
            : "Could not load readiness data.",
        );
      }

      setReadiness(readinessPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load monthly KPI dashboard.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingSkeleton />;

  if (error || !readiness) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--badge-error-text)] mb-4">{error ?? "Could not load monthly KPI dashboard."}</p>
        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex items-center pointer-coarse:min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] hover:opacity-90"
        >
          Try Again
        </button>
      </div>
    );
  }

  const { summary } = readiness;
  const unmatchedGoals =
    summary.pathwayCoverage.eligibleGoals - summary.pathwayCoverage.goalsWithPathway;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-success">
          Monthly snapshot — {readiness.month}
        </p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
          Monthly KPI Dashboard
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Key metrics for this month&apos;s program review.
        </p>
      </div>

      {/* Section 1: Student Readiness Snapshot */}
      <section>
        <p className="mb-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Student readiness
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Average readiness"
            value={`${summary.averageReadiness}%`}
            sub={`Median: ${summary.medianReadiness}%`}
            tone={
              summary.averageReadiness >= 75
                ? "text-[var(--badge-success-text)]"
                : summary.averageReadiness >= 50
                  ? "text-[var(--badge-warning-text)]"
                  : "text-[var(--badge-error-text)]"
            }
          />
          <StatCard
            label="Above 75% readiness"
            value={summary.studentsAbove75}
            sub={`of ${summary.totalStudents} students`}
            tone="text-[var(--badge-success-text)]"
          />
          <StatCard
            label="Above 50% readiness"
            value={summary.studentsAbove50}
            sub={`of ${summary.totalStudents} students`}
            tone="text-[var(--badge-info-text)]"
          />
          <StatCard
            label="Total students"
            value={summary.totalStudents}
            sub="Active in program"
          />
        </div>

        <div className="mt-4 theme-card rounded-2xl p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)] mb-1">
            Goal counts
          </p>
          <h3 className="text-lg font-semibold text-[var(--ink-strong)] mb-4">
            Progress toward plans
          </h3>
          <div className="space-y-3">
            <ProgressRow label="Total goals" value={summary.totalGoals} max={summary.totalGoals} />
            <ProgressRow
              label="Completed"
              value={summary.totalCompleted}
              max={summary.totalGoals}
              color="bg-[var(--accent-green)]"
            />
            <ProgressRow
              label="Confirmed by teacher"
              value={summary.totalConfirmed}
              max={summary.totalGoals}
              color="bg-[var(--accent-blue)]"
            />
          </div>
        </div>
      </section>

      {/* Section 2: Pathway Coverage */}
      <section>
        <p className="mb-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Pathway coverage
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Coverage rate"
            value={`${summary.pathwayCoverage.coverageRate}%`}
            sub={`${summary.pathwayCoverage.goalsWithPathway} of ${summary.pathwayCoverage.eligibleGoals} eligible goals`}
            tone={
              summary.pathwayCoverage.coverageRate >= 80
                ? "text-[var(--badge-success-text)]"
                : summary.pathwayCoverage.coverageRate >= 50
                  ? "text-[var(--badge-warning-text)]"
                  : "text-[var(--badge-error-text)]"
            }
          />
          <StatCard
            label="Goals with pathway"
            value={summary.pathwayCoverage.goalsWithPathway}
            sub="Eligible goals assigned a pathway"
            tone="text-[var(--badge-info-text)]"
          />
          <StatCard
            label="Unmatched goals"
            value={unmatchedGoals}
            sub="Eligible goals without a pathway"
            tone={unmatchedGoals > 0 ? "text-[var(--badge-warning-text)]" : "text-[var(--badge-success-text)]"}
          />
        </div>

        {summary.requirementCompliance && (
          <div className="mt-4 theme-card rounded-2xl p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)] mb-1">
              Class requirements
            </p>
            <h3 className="text-lg font-semibold text-[var(--ink-strong)] mb-4">
              Compliance status
            </h3>
            <div className="space-y-3">
              <ProgressRow
                label={`Compliant students (${summary.requirementCompliance.complianceRate}%)`}
                value={summary.requirementCompliance.compliantStudents}
                max={summary.requirementCompliance.totalStudents}
                color={
                  summary.requirementCompliance.complianceRate >= 80
                    ? "bg-[var(--accent-green)]"
                    : "bg-[var(--accent-gold)]"
                }
              />
            </div>
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Average {summary.requirementCompliance.averageMet} of{" "}
              {summary.requirementCompliance.totalRequired} required items met per student.
            </p>
          </div>
        )}
      </section>

      {/* Section 3: Quick Actions */}
      <section>
        <p className="mb-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Quick actions
        </p>
        <QuickActions classId={classId} />
      </section>
    </div>
  );
}
