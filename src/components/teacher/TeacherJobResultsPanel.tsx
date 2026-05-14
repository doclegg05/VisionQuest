"use client";

import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  Briefcase,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import type { JobWorkMode } from "@/lib/job-board/types";
import { formatJobWorkMode } from "@/lib/job-board/work-mode";

interface SourceOption {
  value: string;
  label: string;
}

interface TeacherJobResult {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: JobWorkMode;
  workModeLabel: string;
  salary: string | null;
  description: string;
  url: string;
  sourceLabel: string;
  sources: SourceOption[];
  duplicateCount: number;
  sourceCount: number;
  clusters: string[];
  workModes: JobWorkMode[];
  savedCount: number;
  updatedAt: string;
}

interface TeacherJobsResponse {
  jobs: TeacherJobResult[];
  sourceOptions: SourceOption[];
  workModeOptions: Array<{ value: JobWorkMode; label: string }>;
  totalListings: number;
  totalUnique: number;
  filteredUnique: number;
  duplicateGroups: number;
  duplicateListings: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface TeacherJobResultsPanelProps {
  classId: string;
  refreshKey: number;
}

const CLUSTER_OPTIONS = [
  { value: "", label: "All clusters" },
  { value: "office-admin", label: "Office & Admin" },
  { value: "finance-bookkeeping", label: "Finance" },
  { value: "tech-digital", label: "Technology" },
  { value: "creative-design", label: "Creative" },
  { value: "customer-service", label: "Customer Service" },
  { value: "career-readiness", label: "Workforce Ready" },
  { value: "language-esl", label: "ESL" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Recently updated" },
  { value: "salary", label: "Highest salary" },
  { value: "company", label: "Company" },
  { value: "title", label: "Title" },
];

const WORK_MODE_STYLES: Record<JobWorkMode, string> = {
  onsite: "bg-emerald-500/15 text-emerald-700",
  remote: "bg-sky-500/15 text-sky-700",
  hybrid: "bg-amber-500/15 text-amber-700",
};

function clusterLabel(cluster: string): string {
  return CLUSTER_OPTIONS.find((option) => option.value === cluster)?.label ?? cluster;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return typeof data.error === "string" ? data.error : "Could not load job results.";
  } catch {
    return "Could not load job results.";
  }
}

export function TeacherJobResultsPanel({ classId, refreshKey }: TeacherJobResultsPanelProps) {
  const [data, setData] = useState<TeacherJobsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [cluster, setCluster] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        classId,
        page: String(page),
        pageSize: "25",
        sort,
      });
      if (query.trim()) params.set("q", query.trim());
      if (source) params.set("source", source);
      if (cluster) params.set("cluster", cluster);
      if (workMode) params.set("workMode", workMode);

      const res = await fetch(`/api/teacher/jobs/results?${params}`);
      if (!cancelled && res.ok) {
        setData(await res.json());
      } else if (!cancelled) {
        setError(await readErrorMessage(res));
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [classId, query, source, cluster, workMode, sort, page, refreshKey]);

  const hasMergedListings = (data?.duplicateListings ?? 0) > 0;

  return (
    <div className="surface-section rounded-xl p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Briefcase size={18} className="text-[var(--primary)]" />
            <p className="text-sm font-medium text-[var(--text-primary)]">Job results</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            {data
              ? `${data.totalUnique} unique roles from ${data.totalListings} active listings`
              : "Active jobs found for this class."}
            {hasMergedListings ? ` · ${data?.duplicateListings} duplicate postings merged` : ""}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[20rem]">
          <div className="rounded-lg border border-[var(--border)] px-2 py-2">
            <p className="text-base font-semibold text-[var(--text-primary)]">{data?.totalUnique ?? 0}</p>
            <p className="text-[0.68rem] text-[var(--text-secondary)]">roles</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] px-2 py-2">
            <p className="text-base font-semibold text-[var(--text-primary)]">{data?.duplicateGroups ?? 0}</p>
            <p className="text-[0.68rem] text-[var(--text-secondary)]">merged</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] px-2 py-2">
            <p className="text-base font-semibold text-[var(--text-primary)]">{data?.filteredUnique ?? 0}</p>
            <p className="text-[0.68rem] text-[var(--text-secondary)]">shown</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 xl:grid-cols-[minmax(12rem,1fr)_11rem_11rem_11rem_11rem]">
        <label className="relative block">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
          />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search title, company, location"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)]"
          />
        </label>
        <select
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">All sources</option>
          {(data?.sourceOptions ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={cluster}
          onChange={(event) => {
            setCluster(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          {CLUSTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={workMode}
          onChange={(event) => {
            setWorkMode(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">All work modes</option>
          {(data?.workModeOptions ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-[var(--error)]/40 px-3 py-2 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-secondary)]">
            Loading job results...
          </div>
        )}

        {!loading && data?.jobs.length === 0 && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-secondary)]">
            No jobs match the current filters.
          </div>
        )}

        {!loading && data?.jobs.map((job) => (
          <div key={job.id} className="rounded-lg border border-[var(--border)] px-3 py-3">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-[var(--text-primary)]">{job.title}</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {job.company} · {job.location}
                  {job.salary ? ` · ${job.salary}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {job.savedCount > 0 && (
                  <span className="rounded-full bg-[var(--surface-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                    {job.savedCount} saved
                  </span>
                )}
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--primary)]"
                >
                  <ArrowSquareOut size={14} />
                  View
                </a>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{job.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.workModes.slice(0, 3).map((mode) => (
                <span
                  key={mode}
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    WORK_MODE_STYLES[mode] ?? "bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
                  }`}
                >
                  {formatJobWorkMode(mode)}
                </span>
              ))}
              {job.sources.slice(0, 4).map((item) => (
                <span
                  key={item.value}
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                >
                  {item.label}
                </span>
              ))}
              {job.sourceCount > 4 && (
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                  +{job.sourceCount - 4} sources
                </span>
              )}
              {job.duplicateCount > 1 && (
                <span className="rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-xs text-[var(--primary)]">
                  merged {job.duplicateCount} postings
                </span>
              )}
              {job.clusters.slice(0, 3).map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                >
                  {clusterLabel(item)}
                </span>
              ))}
              <span className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                Updated {formatDate(job.updatedAt)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={data.page <= 1}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-primary)] disabled:opacity-50"
          >
            <CaretLeft size={14} />
            Previous
          </button>
          <p className="text-xs text-[var(--text-secondary)]">
            Page {data.page} of {data.totalPages}
          </p>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
            disabled={data.page >= data.totalPages}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-primary)] disabled:opacity-50"
          >
            Next
            <CaretRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
