"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Payload interfaces (redeclared for client boundary)
// ---------------------------------------------------------------------------

interface GrantMetric {
  label: string;
  numerator: number;
  denominator: number;
  value: number;
  target: number | null;
  meetsTarget: boolean | null;
}

interface ProgramOfTheYearCriterion {
  label: string;
  met: boolean;
  value: number;
  target: number;
}

interface GrantKpiPayload {
  generatedAt: string;
  programYear: string;
  metrics: {
    enrollmentRate: GrantMetric;
    jobPlacementRate: GrantMetric;
    highWagePlacementRate: GrantMetric;
    postSecondaryTransition: GrantMetric;
    threeMonthRetention: GrantMetric;
    sixMonthRetention: GrantMetric;
  };
  programOfTheYear: {
    qualified: boolean;
    criteria: ProgramOfTheYearCriterion[];
  };
  counts: {
    referred: number;
    enrolled: number;
    placed: number;
    highWage: number;
    postSecondary: number;
  };
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

const METRIC_KEY_MAP: Record<string, string> = {
  "Enrollment Rate": "enrollment",
  "Job Placement Rate": "placement",
  "High-Wage Placement Rate": "high_wage",
  "Post-Secondary Transition": "post_secondary",
  "3-Month Retention": "retention_3mo",
  "6-Month Retention": "retention_6mo",
};

function MetricCard({
  m,
  onDrillDown,
}: {
  m: GrantMetric;
  onDrillDown?: (metricKey: string) => void;
}) {
  const statusColor =
    m.meetsTarget === true
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : m.meetsTarget === false
        ? "text-amber-800 bg-amber-50 border-amber-200"
        : "text-[var(--ink-strong)] bg-white border-gray-200";

  const metricKey = METRIC_KEY_MAP[m.label];

  return (
    <button
      type="button"
      onClick={() => metricKey && onDrillDown?.(metricKey)}
      className={`rounded-xl border p-4 text-left transition-shadow hover:shadow-md ${statusColor}`}
    >
      <p className="text-xs uppercase tracking-[0.16em] opacity-70">{m.label}</p>
      <p className="mt-2 text-3xl font-bold">{m.value}%</p>
      <p className="mt-1 text-xs opacity-70">
        {m.numerator} of {m.denominator}
        {m.target !== null && (
          <span className="ml-2">
            (target: {m.target}%{m.meetsTarget ? " \u2713" : ""})
          </span>
        )}
      </p>
      {metricKey && (
        <p className="mt-2 text-xs opacity-50">Click to view students</p>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Program of the Year badge
// ---------------------------------------------------------------------------

function ProgramOfTheYearBadge({
  qualified,
  criteria,
}: {
  qualified: boolean;
  criteria: ProgramOfTheYearCriterion[];
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        qualified
          ? "border-emerald-300 bg-emerald-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{qualified ? "\u2705" : "\u26a0\ufe0f"}</span>
        <div>
          <p className="font-semibold text-gray-900">
            Program of the Year {qualified ? "Qualified" : "Not Yet Qualified"}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Requires all three criteria to be met
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {criteria.map((c) => (
          <div key={c.label} className="flex items-center gap-2 text-sm">
            <span className={c.met ? "text-emerald-600" : "text-amber-600"}>
              {c.met ? "\u2713" : "\u2717"}
            </span>
            <span className="text-gray-700">{c.label}</span>
            <span className="ml-auto font-semibold text-gray-900">{c.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counts summary
// ---------------------------------------------------------------------------

function CountsSummary({ counts }: { counts: GrantKpiPayload["counts"] }) {
  const items = [
    { label: "Referred", value: counts.referred, tone: "text-[var(--ink-strong)]" },
    { label: "Enrolled", value: counts.enrolled, tone: "text-sky-700" },
    { label: "Placed", value: counts.placed, tone: "text-emerald-700" },
    { label: "High-Wage", value: counts.highWage, tone: "text-violet-700" },
    { label: "Post-Secondary", value: counts.postSecondary, tone: "text-teal-700" },
  ];

  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{item.label}</p>
          <p className={`mt-2 text-3xl font-bold ${item.tone}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DrillDownStudent {
  spokesRecordId: string;
  studentId: string | null;
  name: string;
  status: string;
  referralDate: string | null;
  enrolledAt: string | null;
  employedAt: string | null;
  hourlyWage: number | null;
  postSecondaryAt: string | null;
}

export default function GrantKpiReport() {
  const [data, setData] = useState<GrantKpiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<{
    metric: string;
    students: DrillDownStudent[];
  } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/reports/grant-kpi");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && typeof payload.error === "string"
            ? payload.error
            : "Could not load grant KPI report.",
        );
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load grant KPI report.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDrillDown(metricKey: string) {
    try {
      setDrillLoading(true);
      const res = await fetch(`/api/teacher/reports/grant-kpi/students?metric=${metricKey}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load students.");
      setDrillDown({ metric: metricKey, students: payload.students });
    } catch {
      setDrillDown(null);
    } finally {
      setDrillLoading(false);
    }
  }

  function handleExportCsv() {
    const a = document.createElement("a");
    a.href = "/api/teacher/reports/grant-kpi?format=csv";
    a.download = "";
    a.click();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading grant metrics...</p>;

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error || "Could not load grant KPI report."}</p>
        <button
          onClick={() => void loadData()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const metricList = [
    data.metrics.enrollmentRate,
    data.metrics.jobPlacementRate,
    data.metrics.highWagePlacementRate,
    data.metrics.postSecondaryTransition,
    data.metrics.threeMonthRetention,
    data.metrics.sixMonthRetention,
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
          State grant metrics
        </p>
        <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">
          WV SPOKES — {data.programYear}
        </h2>
      </div>

      <CountsSummary counts={data.counts} />

      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-gray-400">Performance metrics</p>
        <h3 className="mt-2 text-lg font-semibold text-gray-900">Grant outcomes</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {metricList.map((m) => (
            <MetricCard key={m.label} m={m} onDrillDown={handleDrillDown} />
          ))}
        </div>
      </div>

      {drillLoading && (
        <p className="text-sm text-gray-400">Loading student details...</p>
      )}

      {drillDown && !drillLoading && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              {drillDown.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} — {drillDown.students.length} student{drillDown.students.length !== 1 ? "s" : ""}
            </h3>
            <button
              type="button"
              onClick={() => setDrillDown(null)}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          {drillDown.students.length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">No students match this metric.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-gray-400">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Enrolled</th>
                    <th className="pb-2 pr-4">Employed</th>
                    <th className="pb-2">Wage</th>
                  </tr>
                </thead>
                <tbody>
                  {drillDown.students.map((s) => (
                    <tr key={s.spokesRecordId} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium text-gray-900">
                        {s.studentId ? (
                          <a href={`/teacher/students/${s.studentId}`} className="hover:underline">
                            {s.name}
                          </a>
                        ) : (
                          s.name
                        )}
                      </td>
                      <td className="py-2 pr-4 text-gray-600">{s.status}</td>
                      <td className="py-2 pr-4 text-gray-600">
                        {s.enrolledAt ? new Date(s.enrolledAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-4 text-gray-600">
                        {s.employedAt ? new Date(s.employedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 text-gray-600">
                        {s.hourlyWage ? `$${s.hourlyWage.toFixed(2)}/hr` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ProgramOfTheYearBadge
        qualified={data.programOfTheYear.qualified}
        criteria={data.programOfTheYear.criteria}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExportCsv}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
