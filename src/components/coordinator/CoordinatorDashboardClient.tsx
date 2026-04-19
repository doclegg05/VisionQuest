"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import FormRollupList from "./FormRollupList";
import GrantProgressPanel from "./GrantProgressPanel";
import InstructorGrid from "./InstructorGrid";
import MonthlyReportExporter from "./MonthlyReportExporter";
import RegionRollupCard from "./RegionRollupCard";

interface RegionOption {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface GrantGoalRow {
  id: string;
  metric: string;
  programType: string;
  targetValue: number;
  actualValue: number;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  status: "on_track" | "at_risk" | "behind" | "not_started";
}

interface RollupResponse {
  rollup: {
    regionId: string;
    regionName: string;
    periodStart: string;
    periodEnd: string;
    headline: {
      activeStudents: number;
      enrollmentsInPeriod: number;
      certificationsInPeriod: number;
      placementsInPeriod: number;
      gedEarnedInPeriod: number;
    };
    grantGoals: GrantGoalRow[];
    classCount: number;
  };
  instructorMetrics: Array<{
    instructor: { id: string; studentId: string; displayName: string; email: string | null };
    activeStudents: number;
    alertResponseDays: number | null;
    certPassRate: number | null;
    formCompletionRate: number | null;
    classCount: number;
  }>;
  unregionedClasses: number;
}

export default function CoordinatorDashboardClient({ regions }: { regions: RegionOption[] }) {
  const [regionId, setRegionId] = useState<string>(regions[0]?.id ?? "");
  const [data, setData] = useState<RollupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRollup = useCallback(async (targetRegionId: string) => {
    if (!targetRegionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<RollupResponse>(`/api/coordinator/rollup/${targetRegionId}`);
      setData(res);
    } catch {
      setError("Failed to load rollup for this region.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRollup(regionId);
  }, [regionId, loadRollup]);

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        {regions.length > 1 && (
          <label className="inline-flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Region
            </span>
            <select
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              className="field rounded-lg px-3 py-2 text-sm"
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name} ({region.code})
                </option>
              ))}
            </select>
          </label>
        )}
        {regionId && <MonthlyReportExporter regionId={regionId} />}
      </div>

      {error && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {data && data.unregionedClasses > 0 && (
        <p className="rounded-lg border border-dashed border-[var(--badge-warning-bg)] bg-[var(--badge-warning-bg)] p-3 text-xs text-[var(--badge-warning-text)]">
          {data.unregionedClasses} class{data.unregionedClasses === 1 ? "" : "es"} in the system
          {" "}have no region set and are excluded from every regional rollup. Assign them from the admin class editor.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading rollup…</p>
      ) : data ? (
        <div className="space-y-5">
          <RegionRollupCard rollup={data.rollup} />
          <GrantProgressPanel goals={data.rollup.grantGoals} regionId={regionId} onChange={() => loadRollup(regionId)} />
          <InstructorGrid metrics={data.instructorMetrics} />
          <FormRollupList />
        </div>
      ) : null}
    </>
  );
}
