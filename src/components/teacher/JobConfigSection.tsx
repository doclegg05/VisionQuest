"use client";

import { useState, useEffect } from "react";
import { Briefcase, ArrowClockwise } from "@phosphor-icons/react";
import { DEFAULT_JOB_SOURCES, JOB_SOURCE_OPTIONS } from "@/lib/job-board/source-options";
import type { JobScrapeRunStatusResult, JobSourceHealthResult } from "@/lib/job-board/types";

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
  autoRefresh: boolean;
  lastScrapedAt: string | null;
}

const RADIUS_OPTIONS = [10, 25, 50];

export function JobConfigSection() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [config, setConfig] = useState<JobConfig | null>(null);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scrapeRun, setScrapeRun] = useState<JobScrapeRunStatusResult | null>(null);
  const [recentRuns, setRecentRuns] = useState<JobScrapeRunStatusResult[]>([]);
  const [sourceHealth, setSourceHealth] = useState<JobSourceHealthResult[]>([]);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);

  // Form state
  const [region, setRegion] = useState("");
  const [radius, setRadius] = useState(25);
  const [sources, setSources] = useState<string[]>([...DEFAULT_JOB_SOURCES]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const scrapeInProgress = scrapeRun?.status === "queued" || scrapeRun?.status === "processing";
  const failedSources = scrapeRun?.sourceResults
    .filter((source) => source.status === "failed")
    .map((source) => source.source) ?? [];
  const selectedSourceHealth = sourceHealth.filter((source) => source.selected);
  const selectedUnavailableSources = sourceHealth.filter(
    (source) => sources.includes(source.source) && !source.configured,
  );

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
      const res = await fetch(`/api/teacher/jobs/config?classId=${encodeURIComponent(selectedClassId)}`);
      if (!cancelled && res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setActiveJobCount(data.activeJobCount);
        if (data.config) {
          setRegion(data.config.region);
          setRadius(data.config.radius);
          setSources(data.config.sources);
          setAutoRefresh(data.config.autoRefresh);
        } else {
          setRegion("");
          setRadius(25);
          setSources([...DEFAULT_JOB_SOURCES]);
          setAutoRefresh(true);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedClassId, configRefreshKey]);

  useEffect(() => {
    if (!selectedClassId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/teacher/jobs/status?classId=${encodeURIComponent(selectedClassId)}`);
      if (!cancelled && res.ok) {
        const data = await res.json();
        setScrapeRun(data.latestRun ?? null);
        setRecentRuns(data.recentRuns ?? []);
        setSourceHealth(data.sourceHealth ?? []);
        if (typeof data.activeJobCount === "number") {
          setActiveJobCount(data.activeJobCount);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedClassId, statusRefreshKey]);

  useEffect(() => {
    if (!scrapeInProgress) return;
    const timer = window.setInterval(() => {
      setStatusRefreshKey((key) => key + 1);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [scrapeInProgress]);

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch("/api/teacher/jobs/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: selectedClassId,
        region,
        radius,
        sources,
        autoRefresh,
      }),
    });
    if (res.ok) {
      setConfigRefreshKey((k) => k + 1);
    }
    setSaving(false);
  };

  const handleRefresh = async (retrySources?: string[]) => {
    setRefreshing(true);
    const res = await fetch("/api/teacher/jobs/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: selectedClassId,
        sources: retrySources && retrySources.length > 0 ? retrySources : undefined,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setScrapeRun(data.run ?? null);
      setStatusRefreshKey((key) => key + 1);
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
                onClick={() => void handleRefresh()}
                disabled={refreshing || scrapeInProgress}
                className="flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <ArrowClockwise size={16} className={refreshing || scrapeInProgress ? "animate-spin" : ""} />
                {scrapeInProgress ? "Refreshing..." : refreshing ? "Queueing..." : "Refresh Now"}
              </button>
            </div>
          )}

          {scrapeRun && (
            <div className="surface-section rounded-xl p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Job Scout status: {scrapeRun.status}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Sources {scrapeRun.completedSources}/{scrapeRun.totalSources}
                    {scrapeRun.failedSources > 0 ? `, ${scrapeRun.failedSources} failed` : ""}
                    {" · "}
                    {scrapeRun.totalFetched} fetched, {scrapeRun.totalUpserted} saved
                  </p>
                  {scrapeRun.error && (
                    <p className="mt-2 text-xs text-[var(--error)]">{scrapeRun.error}</p>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  {scrapeRun.completedAt
                    ? `Completed ${new Date(scrapeRun.completedAt).toLocaleString()}`
                    : scrapeRun.startedAt
                      ? `Started ${new Date(scrapeRun.startedAt).toLocaleString()}`
                      : `Queued ${new Date(scrapeRun.queuedAt).toLocaleString()}`}
                </p>
              </div>
              {scrapeRun.sourceResults.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {scrapeRun.sourceResults.map((source) => (
                    <div
                      key={source.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-primary)]">{source.source}</span>
                        <span className="text-xs text-[var(--text-secondary)]">{source.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {source.fetchedCount} fetched, {source.upsertedCount} saved
                      </p>
                      {source.error && (
                        <p className="mt-1 text-xs text-[var(--error)]">{source.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {failedSources.length > 0 && !scrapeInProgress && (
                <button
                  type="button"
                  onClick={() => void handleRefresh(failedSources)}
                  disabled={refreshing}
                  className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50"
                >
                  Retry failed sources
                </button>
              )}
            </div>
          )}

          {selectedSourceHealth.length > 0 && (
            <div className="surface-section rounded-xl p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Source health</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Recent source reliability and configuration status.
                  </p>
                </div>
                {selectedUnavailableSources.length > 0 && (
                  <p className="text-xs text-[var(--error)]">
                    {selectedUnavailableSources.length} selected source
                    {selectedUnavailableSources.length === 1 ? "" : "s"} need configuration.
                  </p>
                )}
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-3">
                {selectedSourceHealth.map((source) => (
                  <div
                    key={source.source}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)]">{source.label}</span>
                      <span className={`text-xs ${source.configured ? "text-[var(--text-secondary)]" : "text-[var(--error)]"}`}>
                        {source.configured ? "configured" : "missing key"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {source.successRate === null ? "No recent runs" : `${source.successRate}% success`}
                      {source.lastStatus ? ` · last ${source.lastStatus}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {source.lastFetchedCount} fetched, {source.lastUpsertedCount} saved
                    </p>
                    {source.lastError && (
                      <p className="mt-1 text-xs text-[var(--error)]">{source.lastError}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentRuns.length > 1 && (
            <div className="surface-section rounded-xl p-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">Recent scrape history</p>
              <div className="mt-3 space-y-2">
                {recentRuns.slice(0, 5).map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-col gap-1 rounded-lg border border-[var(--border)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-xs text-[var(--text-primary)]">
                      {run.status} · {run.completedSources}/{run.totalSources} sources · {run.totalUpserted} saved
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {run.completedAt
                        ? new Date(run.completedAt).toLocaleString()
                        : new Date(run.queuedAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Config form */}
          <div className="space-y-4">
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

            <div>
              <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
                Job Sources
              </label>
              <div className="flex flex-wrap gap-2">
                {JOB_SOURCE_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex flex-col gap-1">
                    <button
                      onClick={() => toggleSource(opt.value)}
                      className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                        sources.includes(opt.value)
                          ? "bg-[var(--primary)]/20 border-[var(--primary)] text-[var(--primary)]"
                          : "bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                    {sourceHealth.find(
                      (source) =>
                        source.source === opt.value &&
                        sources.includes(opt.value) &&
                        !source.configured,
                    ) && (
                      <span className="px-1 text-xs text-[var(--error)]">Unavailable</span>
                    )}
                  </div>
                ))}
              </div>
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
