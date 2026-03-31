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
  autoRefresh: boolean;
  lastScrapedAt: string | null;
}

const SOURCE_OPTIONS = [
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

  // Form state
  const [region, setRegion] = useState("");
  const [radius, setRadius] = useState(25);
  const [sources, setSources] = useState<string[]>(["jsearch"]);
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
      const res = await fetch(`/api/teacher/jobs/config?classId=${selectedClassId}`);
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
          setSources(["jsearch"]);
          setAutoRefresh(true);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedClassId, configRefreshKey]);

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

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetch("/api/teacher/jobs/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: selectedClassId }),
    });
    // Wait briefly then refresh config to show updated count
    setTimeout(() => {
      setConfigRefreshKey((k) => k + 1);
      setRefreshing(false);
    }, 3000);
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
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <ArrowClockwise size={16} className={refreshing ? "animate-spin" : ""} />
                {refreshing ? "Refreshing..." : "Refresh Now"}
              </button>
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
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleSource(opt.value)}
                    className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                      sources.includes(opt.value)
                        ? "bg-[var(--primary)]/20 border-[var(--primary)] text-[var(--primary)]"
                        : "bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {opt.label}
                  </button>
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
