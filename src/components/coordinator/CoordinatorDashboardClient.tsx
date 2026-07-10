"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import CoordinatorRegionMap from "./CoordinatorRegionMap";
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
  sageEffectiveness: {
    totalProposed: number;
    pending: number;
    confirmed: number;
    dismissed: number;
    confirmationRate: number;
    confirmedWithin14Days: number;
    confirmationRateWithin14Days: number;
    averageDaysToConfirmation: number | null;
    periodStart: string;
    periodEnd: string;
  };
  wagerHitRate: {
    open: number;
    won: number;
    lost: number;
    voided: number;
    hitRate: number;
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function fetchRegionRollup(targetRegionId: string): Promise<RollupResponse> {
  return api.get<RollupResponse>(`/api/coordinator/rollup/${targetRegionId}`);
}

function SageEffectivenessCard({ metrics }: { metrics: RollupResponse["sageEffectiveness"] }) {
  return (
    <section className="theme-card rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Sage Goal Follow-Through</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Proposed goals accepted by students or staff during this reporting period.
          </p>
        </div>
        <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
          {formatPercent(metrics.confirmationRateWithin14Days)} within 14 days
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[
          ["Proposed", metrics.totalProposed],
          ["Confirmed", metrics.confirmed],
          ["Pending", metrics.pending],
          ["Dismissed", metrics.dismissed],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <p className="text-2xl font-bold text-[var(--ink-strong)]">{value}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {label}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--ink-muted)]">
        Overall acceptance: {formatPercent(metrics.confirmationRate)}
        {metrics.averageDaysToConfirmation !== null
          ? ` • average ${metrics.averageDaysToConfirmation.toFixed(1)} days to confirm`
          : ""}
      </p>
    </section>
  );
}

function WagerHitRateCard({ metrics }: { metrics: RollupResponse["wagerHitRate"] }) {
  return (
    <section className="theme-card rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Sage wager hit-rate (program-wide, 30d)</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Goal-proposal wagers settled in the last 30 days — not region-scoped.
          </p>
        </div>
        <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
          {formatPercent(metrics.hitRate)} hit rate
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[
          ["Won", metrics.won],
          ["Lost", metrics.lost],
          ["Open", metrics.open],
          ["Voided", metrics.voided],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <p className="text-2xl font-bold text-[var(--ink-strong)]">{value}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {label}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--ink-muted)]">
        Hit rate = won ÷ (won + lost). Open wagers are excluded from the rate.
      </p>
    </section>
  );
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
      const res = await fetchRegionRollup(targetRegionId);
      setData(res);
    } catch {
      setError("Failed to load rollup for this region.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Adjust-during-render: reset loading/error the same render pass regionId
  // changes (React's documented "adjusting state on prop/state change"
  // pattern) since the effect below may no longer call setState synchronously.
  const [trackedRegionId, setTrackedRegionId] = useState(regionId);
  if (trackedRegionId !== regionId) {
    setTrackedRegionId(regionId);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    if (!regionId) return;
    let cancelled = false;
    fetchRegionRollup(regionId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load rollup for this region.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  return (
    <>
      <CoordinatorRegionMap
        regions={regions}
        activeRegionId={regionId}
        onSelect={setRegionId}
      />

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
          <SageEffectivenessCard metrics={data.sageEffectiveness} />
          <WagerHitRateCard metrics={data.wagerHitRate} />
          <GrantProgressPanel goals={data.rollup.grantGoals} regionId={regionId} onChange={() => loadRollup(regionId)} />
          <InstructorGrid metrics={data.instructorMetrics} />
          <FormRollupList />
        </div>
      ) : null}
    </>
  );
}
