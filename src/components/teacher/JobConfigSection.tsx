"use client";

import { useState, useEffect } from "react";
import { Briefcase, ArrowClockwise } from "@phosphor-icons/react";

interface ClassOption {
  id: string;
  name: string;
  code: string;
}

interface JobConfig {
  id: string;
  classId: string;
  region: string;
  radius: number;
  sources: string[];
  targetRoles: string[];
  excludedEmployers: string[];
  remoteOnly: boolean;
  wageFloor: number | null;
  autoRefresh: boolean;
  lastScrapedAt: string | null;
}

interface UsageWindow {
  limit: number | null;
  used: number;
  remaining: number | null;
  resetTime: number | null;
}

interface SourceUsage {
  source: string;
  daily: UsageWindow;
  monthly: UsageWindow;
  provider: ProviderUsageWindow[];
}

interface ManualRefreshStatus {
  cooldownMinutes: number;
  available: boolean;
  resetTime: number | null;
}

interface SourceStatus {
  source: string;
  label: string;
  kind: "official" | "aggregator";
  configured: boolean;
  enabled: boolean;
  recommended: boolean;
}

interface ProviderUsageWindow {
  id: string;
  label: string;
  limit: number;
  used: number;
  remaining: number;
  resetTime: number | null;
  updatedAt: number | null;
}

const SOURCE_OPTIONS = [
  { value: "careeronestop", label: "CareerOneStop Jobs (Official)" },
  { value: "jsearch", label: "JSearch (RapidAPI)" },
  { value: "usajobs", label: "USAJobs (Federal)" },
  { value: "adzuna", label: "Adzuna" },
];

const RADIUS_OPTIONS = [10, 25, 50];

export function JobConfigSection() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [config, setConfig] = useState<JobConfig | null>(null);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<SourceUsage[]>([]);
  const [manualRefresh, setManualRefresh] = useState<ManualRefreshStatus | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);

  // Form state
  const [region, setRegion] = useState("");
  const [radius, setRadius] = useState(25);
  const [sources, setSources] = useState<string[]>(["careeronestop"]);
  const [targetRolesText, setTargetRolesText] = useState("");
  const [excludedEmployersText, setExcludedEmployersText] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [wageFloor, setWageFloor] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch classes on mount
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/teacher/classes");
      if (res.ok) {
        const data = await res.json();
        const list: ClassOption[] = (data.classes ?? data ?? []).map((c: { id: string; name: string; code: string }) => ({
          id: c.id,
          name: c.name,
          code: c.code,
        }));
        setClasses(list);
        if (list.length > 0) setSelectedClassId(list[0].id);
      }
    })();
  }, []);

  const [configRefreshKey, setConfigRefreshKey] = useState(0);

  useEffect(() => {
    if (!selectedClassId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/teacher/jobs/config?classId=${selectedClassId}`);
      if (!cancelled && res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setActiveJobCount(data.activeJobCount);
        setUsage(data.usage ?? []);
        setManualRefresh(data.manualRefresh ?? null);
        setSourceStatus(data.sourceStatus ?? []);
        if (data.config) {
          setRegion(data.config.region);
          setRadius(data.config.radius);
          setSources(data.config.sources);
          setTargetRolesText((data.config.targetRoles ?? []).join("\n"));
          setExcludedEmployersText((data.config.excludedEmployers ?? []).join("\n"));
          setRemoteOnly(Boolean(data.config.remoteOnly));
          setWageFloor(data.config.wageFloor != null ? String(data.config.wageFloor) : "");
          setAutoRefresh(data.config.autoRefresh);
        } else {
          setRegion("");
          setRadius(25);
          setSources(["careeronestop"]);
          setTargetRolesText("");
          setExcludedEmployersText("");
          setRemoteOnly(false);
          setWageFloor("");
          setAutoRefresh(true);
        }
      } else if (!cancelled) {
        setError("Unable to load job board settings.");
        setUsage([]);
        setManualRefresh(null);
        setSourceStatus([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedClassId, configRefreshKey]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    const res = await fetch("/api/teacher/jobs/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: selectedClassId,
        region,
        radius,
        sources,
        targetRoles: targetRolesText
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean),
        excludedEmployers: excludedEmployersText
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean),
        remoteOnly,
        wageFloor: wageFloor.trim() ? Number(wageFloor) : null,
        autoRefresh,
      }),
    });
    if (res.ok) {
      setMessage(config ? "Job board settings updated." : "Job board enabled.");
      setConfigRefreshKey((k) => k + 1);
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Unable to save job board settings.");
    }
    setSaving(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    setError(null);
    const res = await fetch("/api/teacher/jobs/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: selectedClassId }),
    });
    if (res.ok) {
      const data = await res.json();
      setMessage(data.message ?? "Job refresh complete.");
      setConfigRefreshKey((k) => k + 1);
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Unable to refresh jobs right now.");
    }
    setRefreshing(false);
  };

  const toggleSource = (source: string) => {
    setSources((prev) =>
      prev.includes(source)
        ? prev.filter((s) => s !== source)
        : [...prev, source],
    );
  };

  if (classes.length === 0) {
    return <p className="text-[var(--text-secondary)]">No classes found.</p>;
  }

  const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const sourceLabels: Record<string, string> = Object.fromEntries(
    SOURCE_OPTIONS.map((option) => [option.value, option.label]),
  );
  const sourceStatusBySource = new Map(sourceStatus.map((entry) => [entry.source, entry]));

  return (
    <div className="space-y-6">
      {/* Class selector */}
      <div>
        <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">Class</label>
        <select
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
          className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm w-full max-w-xs"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-[var(--text-secondary)]">Loading config...</p>
      ) : (
        <>
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {message}
            </div>
          )}

          {/* Status display */}
          {config && (
            <div className="surface-section rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-primary)]">
                  <Briefcase size={16} className="inline mr-1" />
                  <strong>{activeJobCount}</strong> active jobs
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Last refreshed: {config.lastScrapedAt
                    ? new Date(config.lastScrapedAt).toLocaleDateString()
                    : "Never"}
                </p>
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing || manualRefresh?.available === false}
                className="flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <ArrowClockwise size={16} className={refreshing ? "animate-spin" : ""} />
                {refreshing ? "Refreshing..." : "Refresh Now"}
              </button>
            </div>
          )}

          <div className="surface-section rounded-xl p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Source Health</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Official sources are preferred. Aggregators stay useful as fallback coverage.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sourceStatus.map((entry) => (
                <div
                  key={entry.source}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{entry.label}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        {entry.kind === "official" ? "Official/public source" : "Aggregator source"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                        entry.configured
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {entry.configured ? "Configured" : "Missing credentials"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {entry.enabled && (
                      <span className="rounded-full bg-[var(--primary)]/15 px-2 py-1 text-[var(--primary)]">
                        Enabled for this class
                      </span>
                    )}
                    {entry.recommended && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">
                        Recommended baseline
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-[var(--border)]" />

            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Usage Guardrails</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                These counters are app-side protection against provider overages. Leave a limit blank in env to disable that cap.
              </p>
            </div>

            {manualRefresh && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2">
                <p className="text-sm text-[var(--text-primary)]">
                  Manual refresh:{" "}
                  <strong>{manualRefresh.available ? "Available now" : "Cooling down"}</strong>
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {manualRefresh.available || !manualRefresh.resetTime
                    ? `Teachers can refresh this class once every ${manualRefresh.cooldownMinutes} minutes.`
                    : `Available again ${dateTimeFormatter.format(new Date(manualRefresh.resetTime))}.`}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {usage.map((item) => (
                <div
                  key={item.source}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 space-y-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {sourceLabels[item.source] ?? item.source}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      {item.daily.limit == null && item.monthly.limit == null
                        ? item.provider.length > 0
                          ? "Showing provider-reported quotas"
                          : "No app-side caps configured"
                        : "Usage resets on UTC windows"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <UsageRow label="Daily" window={item.daily} formatter={dateTimeFormatter} />
                    <UsageRow label="Monthly" window={item.monthly} formatter={dateTimeFormatter} />
                  </div>

                  {item.provider.length > 0 && (
                    <div className="border-t border-[var(--border)] pt-3">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                        Provider headers
                      </p>
                      <div className="mt-2 space-y-2">
                        {item.provider.map((window) => (
                          <UsageRow
                            key={window.id}
                            label={window.label}
                            window={window}
                            formatter={dateTimeFormatter}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Config form */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                  Target Roles
                </label>
                <textarea
                  value={targetRolesText}
                  onChange={(e) => setTargetRolesText(e.target.value)}
                  rows={4}
                  placeholder={"Medical Assistant\nPhlebotomist\nPatient Access Representative"}
                  className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm w-full"
                />
                <p className="text-xs text-[var(--text-secondary)] mt-2">
                  One role per line. The scraper will use the first role as the primary search term and use the rest for filtering.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                  Excluded Employers
                </label>
                <textarea
                  value={excludedEmployersText}
                  onChange={(e) => setExcludedEmployersText(e.target.value)}
                  rows={4}
                  placeholder={"Staffing agency\nExample Employer"}
                  className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm w-full"
                />
                <p className="text-xs text-[var(--text-secondary)] mt-2">
                  Listings from these employers will be filtered out even if a source returns them.
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                Region
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g., Charleston, WV"
                className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm w-full max-w-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                Search Radius
              </label>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm"
              >
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} miles
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                  Wage Floor
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={wageFloor}
                  onChange={(e) => setWageFloor(e.target.value)}
                  placeholder="15"
                  className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm w-full"
                />
                <p className="text-xs text-[var(--text-secondary)] mt-2">
                  Jobs with a known hourly wage below this threshold will be excluded. Jobs without salary data stay visible.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="remoteOnly"
                    checked={remoteOnly}
                    onChange={(e) => setRemoteOnly(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="remoteOnly" className="text-sm text-[var(--text-primary)]">
                    Prioritize remote-only opportunities
                  </label>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-2">
                  This filters out listings that do not appear to be remote and adds a remote hint to supported source queries.
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
                Job Sources
              </label>
              <div className="flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleSource(opt.value)}
                    className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                      sources.includes(opt.value)
                        ? "bg-[var(--primary)]/20 border-[var(--primary)] text-[var(--primary)]"
                        : "bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--text-secondary)]"
                    }`}
                    title={sourceStatusBySource.get(opt.value)?.configured === false
                      ? "This source is not configured in environment variables yet."
                      : undefined}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                Missing-credential sources can stay selected, but they will not contribute listings until configured.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoRefresh"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="autoRefresh" className="text-sm text-[var(--text-primary)]">
                Auto-refresh every Monday at 6 AM
              </label>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !region.trim()}
              className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Saving..." : config ? "Update Config" : "Enable Job Board"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UsageRow({
  label,
  window,
  formatter,
}: {
  label: string;
  window: UsageWindow;
  formatter: Intl.DateTimeFormat;
}) {
  const percentUsed = window.limit ? Math.min((window.used / window.limit) * 100, 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>{label}</span>
        <span>
          {window.limit == null
            ? `${window.used} used`
            : `${window.used}/${window.limit} used`}
        </span>
      </div>
      {window.limit != null && (
        <div className="mt-1 h-2 rounded-full bg-[var(--surface-overlay)]">
          <div
            className={`h-full rounded-full transition-all ${
              percentUsed >= 90 ? "bg-red-400" : percentUsed >= 70 ? "bg-amber-400" : "bg-emerald-400"
            }`}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
      )}
      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
        {window.remaining == null
          ? "No configured cap"
          : `${window.remaining} remaining`}
        {window.resetTime ? ` · resets ${formatter.format(new Date(window.resetTime))}` : ""}
      </div>
    </div>
  );
}
