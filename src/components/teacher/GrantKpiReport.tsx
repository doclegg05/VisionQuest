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
        : "text-[var(--ink-strong)] bg-[var(--surface-raised)] border-[var(--border)]";

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
          : "border-[var(--border)] bg-[var(--surface-raised)]"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{qualified ? "\u2705" : "\u26a0\ufe0f"}</span>
        <div>
          <p className="font-semibold text-[var(--ink-strong)]">
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
            <span className="text-[var(--ink-strong)]">{c.label}</span>
            <span className="ml-auto font-semibold text-[var(--ink-strong)]">{c.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — tiny inline SVG trend chart
// ---------------------------------------------------------------------------

function Sparkline({ values, color = "#0ea5e9" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;

  const width = 120;
  const height = 32;
  const pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  return (
    <svg width={width} height={height} className="inline-block" aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(" ")}
      />
    </svg>
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
        <div key={item.label} className="theme-card rounded-xl p-4 text-center">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{item.label}</p>
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
  const [trendData, setTrendData] = useState<Array<{
    date: string;
    metrics: GrantKpiPayload["metrics"];
  }>>([]);

  useEffect(() => {
    void loadData();
    void loadTrends();
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

  async function loadTrends() {
    try {
      const res = await fetch("/api/teacher/reports/grant-kpi/history");
      if (!res.ok) return;
      const payload = await res.json();
      if (Array.isArray(payload.snapshots)) {
        setTrendData(payload.snapshots);
      }
    } catch {
      // Trends are optional — don't block the dashboard
    }
  }

  function getTrendValues(metricKey: keyof GrantKpiPayload["metrics"]): number[] {
    return trendData.map((s) => s.metrics[metricKey]?.value ?? 0);
  }

  function handleExportCsv() {
    const a = document.createElement("a");
    a.href = "/api/teacher/reports/grant-kpi?format=csv";
    a.download = "";
    a.click();
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading grant metrics...</p>;

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

  const metricEntries: Array<{ key: keyof GrantKpiPayload["metrics"]; metric: GrantMetric }> = [
    { key: "enrollmentRate", metric: data.metrics.enrollmentRate },
    { key: "jobPlacementRate", metric: data.metrics.jobPlacementRate },
    { key: "highWagePlacementRate", metric: data.metrics.highWagePlacementRate },
    { key: "postSecondaryTransition", metric: data.metrics.postSecondaryTransition },
    { key: "threeMonthRetention", metric: data.metrics.threeMonthRetention },
    { key: "sixMonthRetention", metric: data.metrics.sixMonthRetention },
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
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Performance metrics</p>
        <h3 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Grant outcomes</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {metricEntries.map(({ key, metric: m }) => (
            <div key={m.label}>
              <MetricCard m={m} onDrillDown={handleDrillDown} />
              {trendData.length >= 2 && (
                <div className="mt-1 flex items-center gap-2 px-1">
                  <Sparkline
                    values={getTrendValues(key)}
                    color={m.meetsTarget === true ? "#059669" : m.meetsTarget === false ? "#d97706" : "#6b7280"}
                  />
                  <span className="text-xs text-[var(--ink-muted)]">
                    {trendData.length} snapshots
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {drillLoading && (
        <p className="text-sm text-[var(--ink-muted)]">Loading student details...</p>
      )}

      {drillDown && !drillLoading && (
        <div className="theme-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--ink-strong)]">
              {drillDown.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} — {drillDown.students.length} student{drillDown.students.length !== 1 ? "s" : ""}
            </h3>
            <button
              type="button"
              onClick={() => setDrillDown(null)}
              className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink-muted)]"
            >
              Close
            </button>
          </div>
          {drillDown.students.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No students match this metric.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Enrolled</th>
                    <th className="pb-2 pr-4">Employed</th>
                    <th className="pb-2">Wage</th>
                  </tr>
                </thead>
                <tbody>
                  {drillDown.students.map((s) => (
                    <tr key={s.spokesRecordId} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4 font-medium text-[var(--ink-strong)]">
                        {s.studentId ? (
                          <a href={`/teacher/students/${s.studentId}`} className="hover:underline">
                            {s.name}
                          </a>
                        ) : (
                          s.name
                        )}
                      </td>
                      <td className="py-2 pr-4 text-[var(--ink-muted)]">{s.status}</td>
                      <td className="py-2 pr-4 text-[var(--ink-muted)]">
                        {s.enrolledAt ? new Date(s.enrolledAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-4 text-[var(--ink-muted)]">
                        {s.employedAt ? new Date(s.employedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 text-[var(--ink-muted)]">
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
          className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-soft)]"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
