"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Payload interfaces (redeclared for client boundary)
// ---------------------------------------------------------------------------

interface GoalAdoptionKpis {
  totalStudents: number;
  withBhag: number;
  withBhagPct: number;
  withMonthlyGoal: number;
  withMonthlyGoalPct: number;
  withWeeklyGoal: number;
  withWeeklyGoalPct: number;
  totalActiveGoals: number;
  goalsWithLinkedResources: number;
  goalsWithResourcesPct: number;
}

interface ResourcePipelineKpis {
  totalAssignedLinks: number;
  linksWithEvidence: number;
  linksWithEvidencePct: number;
  linksCompleted: number;
  linksCompletedPct: number;
  studentsWithAnyEvidence: number;
  studentsWithAnyEvidencePct: number;
}

interface TimeToMilestoneKpis {
  medianDaysToFirstGoal: number | null;
  avgDaysToFirstGoal: number | null;
  medianDaysGoalToResource: number | null;
  avgDaysGoalToResource: number | null;
  medianDaysResourceToEvidence: number | null;
  avgDaysResourceToEvidence: number | null;
}

interface ReadinessDistributionKpis {
  distribution: { bucket: string; count: number }[];
  medianScore: number | null;
  avgScore: number | null;
  studentsAbove50: number;
  studentsAbove50Pct: number;
  studentsAbove75: number;
  studentsAbove75Pct: number;
}

interface AcademicFunnelStep {
  label: string;
  value: number;
  pct: number;
}

interface AcademicKpiPayload {
  generatedAt: string;
  goalAdoption: GoalAdoptionKpis;
  resourcePipeline: ResourcePipelineKpis;
  timeToMilestone: TimeToMilestoneKpis;
  readinessDistribution: ReadinessDistributionKpis;
  academicFunnel: AcademicFunnelStep[];
}

// ---------------------------------------------------------------------------
// Stat card helpers
// ---------------------------------------------------------------------------

const ADOPTION_CARDS: Array<{
  key: "withBhagPct" | "withMonthlyGoalPct" | "withWeeklyGoalPct" | "goalsWithResourcesPct";
  countKey: "withBhag" | "withMonthlyGoal" | "withWeeklyGoal" | "goalsWithLinkedResources";
  label: string;
  tone: string;
  denomLabel?: string;
}> = [
  { key: "withBhagPct", countKey: "withBhag", label: "Students with BHAG", tone: "text-violet-700" },
  { key: "withMonthlyGoalPct", countKey: "withMonthlyGoal", label: "With monthly goal", tone: "text-sky-700" },
  { key: "withWeeklyGoalPct", countKey: "withWeeklyGoal", label: "With weekly goal", tone: "text-teal-700" },
  { key: "goalsWithResourcesPct", countKey: "goalsWithLinkedResources", label: "Goals with resources", tone: "text-emerald-700", denomLabel: "goals" },
];

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function GoalAdoptionSection({ data }: { data: GoalAdoptionKpis }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Goal adoption</p>
      <h3 className="mt-2 text-lg font-semibold text-gray-900">Who is planning</h3>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ADOPTION_CARDS.map((card) => (
          <div key={card.key} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{card.label}</p>
            <p className={`mt-2 text-3xl font-bold ${card.tone}`}>{data[card.key]}%</p>
            <p className="mt-1 text-xs text-gray-500">
              {data[card.countKey]} of {card.denomLabel === "goals" ? data.totalActiveGoals : data.totalStudents}{" "}
              {card.denomLabel ?? "students"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourcePipelineSection({ data, totalStudents }: { data: ResourcePipelineKpis; totalStudents: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Resource pipeline</p>
      <h3 className="mt-2 text-lg font-semibold text-gray-900">From assignment to completion</h3>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Assigned</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">{data.totalAssignedLinks}</p>
          <p className="mt-1 text-xs text-gray-500">resource links across all students</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Has evidence</p>
          <p className="mt-2 text-3xl font-bold text-sky-700">{data.linksWithEvidence}</p>
          <p className="mt-1 text-xs text-gray-500">{data.linksWithEvidencePct}% of assigned links</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Completed</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700">{data.linksCompleted}</p>
          <p className="mt-1 text-xs text-gray-500">{data.linksCompletedPct}% of assigned links</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/80 p-4">
        <p className="text-sm font-semibold text-teal-800">
          {data.studentsWithAnyEvidence} of {totalStudents} students
        </p>
        <p className="mt-1 text-xs text-teal-700">
          have submitted evidence on at least one assigned resource ({data.studentsWithAnyEvidencePct}%)
        </p>
      </div>
    </div>
  );
}

function TimeToMilestoneSection({ data }: { data: TimeToMilestoneKpis }) {
  const fmt = (v: number | null) => (v !== null ? `${v} days` : "\u2014");

  const rows: { label: string; median: number | null; avg: number | null }[] = [
    { label: "Enrollment to first goal", median: data.medianDaysToFirstGoal, avg: data.avgDaysToFirstGoal },
    { label: "Goal to first assigned resource", median: data.medianDaysGoalToResource, avg: data.avgDaysGoalToResource },
    { label: "Resource to evidence", median: data.medianDaysResourceToEvidence, avg: data.avgDaysResourceToEvidence },
  ];

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Time to milestone</p>
      <h3 className="mt-2 text-lg font-semibold text-gray-900">How fast students move</h3>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="pb-2 text-left text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)] font-semibold">
                Milestone
              </th>
              <th className="pb-2 text-right text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)] font-semibold">
                Median
              </th>
              <th className="pb-2 text-right text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)] font-semibold">
                Average
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-gray-100">
                <td className="py-3 text-gray-700">{row.label}</td>
                <td className="py-3 text-right font-semibold text-gray-900">{fmt(row.median)}</td>
                <td className="py-3 text-right font-semibold text-gray-900">{fmt(row.avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReadinessDistributionSection({ data }: { data: ReadinessDistributionKpis }) {
  const maxCount = Math.max(1, ...data.distribution.map((b) => b.count));

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Readiness score</p>
      <h3 className="mt-2 text-lg font-semibold text-gray-900">Where students stand</h3>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="space-y-3">
            {data.distribution.map((bucket) => {
              const ratio = (bucket.count / maxCount) * 100;
              return (
                <div key={bucket.bucket}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="w-14 text-gray-600">{bucket.bucket}</span>
                    <span className="font-semibold text-gray-900">{bucket.count}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-secondary),var(--accent-strong))]"
                      style={{ width: `${Math.max(ratio, bucket.count > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-lg border border-sky-200 bg-sky-50/80 p-4">
            <p className="text-sm font-semibold text-sky-800">Median score</p>
            <p className="mt-2 text-2xl font-bold text-sky-900">
              {data.medianScore !== null ? data.medianScore : "\u2014"}
            </p>
          </div>
          <div className="rounded-lg border border-teal-200 bg-teal-50/80 p-4">
            <p className="text-sm font-semibold text-teal-800">Score &ge; 50</p>
            <p className="mt-2 text-2xl font-bold text-teal-900">{data.studentsAbove50}</p>
            <p className="mt-1 text-xs text-teal-700">{data.studentsAbove50Pct}% of students</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-4">
            <p className="text-sm font-semibold text-emerald-800">Score &ge; 75</p>
            <p className="mt-2 text-2xl font-bold text-emerald-900">{data.studentsAbove75}</p>
            <p className="mt-1 text-xs text-emerald-700">{data.studentsAbove75Pct}% of students</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AcademicFunnelSection({ steps, totalStudents }: { steps: AcademicFunnelStep[]; totalStudents: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Pipeline</p>
          <h3 className="mt-2 text-lg font-semibold text-gray-900">Academic journey funnel</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {totalStudents} learners
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {steps.map((step) => {
          const ratio = totalStudents > 0 ? (step.value / totalStudents) * 100 : 0;
          return (
            <div key={step.label}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-600">{step.label}</span>
                <span className="font-semibold text-gray-900">{step.value}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-secondary),var(--accent-strong))]"
                  style={{ width: `${Math.min(100, Math.max(ratio, step.value > 0 ? 6 : 0))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AcademicKpiReport() {
  const [data, setData] = useState<AcademicKpiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/reports/academic-kpi");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && typeof payload.error === "string"
            ? payload.error
            : "Could not load KPI report.",
        );
      }
      setData(payload);
      setError(null);
    } catch (err) {
      console.error("Failed to load academic KPI report:", err);
      setError(err instanceof Error ? err.message : "Could not load KPI report.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading academic KPI report...</p>;

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error || "Could not load KPI report."}</p>
        <button
          onClick={() => void loadData()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
          Academic effectiveness
        </p>
        <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Goal-centric KPIs</h2>
      </div>

      <GoalAdoptionSection data={data.goalAdoption} />
      <ResourcePipelineSection data={data.resourcePipeline} totalStudents={data.goalAdoption.totalStudents} />
      <TimeToMilestoneSection data={data.timeToMilestone} />
      <ReadinessDistributionSection data={data.readinessDistribution} />
      <AcademicFunnelSection steps={data.academicFunnel} totalStudents={data.goalAdoption.totalStudents} />
    </div>
  );
}
