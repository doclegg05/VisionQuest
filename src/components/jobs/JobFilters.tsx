"use client";

const CLUSTER_OPTIONS = [
  { value: "", label: "All Clusters" },
  { value: "office-admin", label: "Office & Admin" },
  { value: "finance-bookkeeping", label: "Finance" },
  { value: "tech-digital", label: "Technology" },
  { value: "creative-design", label: "Creative" },
  { value: "customer-service", label: "Customer Service" },
  { value: "career-readiness", label: "Workforce Ready" },
  { value: "language-esl", label: "ESL" },
];

const SORT_OPTIONS = [
  { value: "recommended", label: "Best Match" },
  { value: "recent", label: "Most Recent" },
  { value: "salary", label: "Highest Salary" },
];

const POSTED_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

const MIN_PAY_OPTIONS = [
  { value: "", label: "Any pay" },
  { value: "12", label: "$12+/hr" },
  { value: "15", label: "$15+/hr" },
  { value: "18", label: "$18+/hr" },
  { value: "20", label: "$20+/hr" },
];

const JOB_TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
];

const CONTROL_CLASSES =
  "min-h-11 rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm";

export type JobProximityFilter = "local" | "remote" | "all";

interface JobFiltersProps {
  cluster: string;
  proximity: JobProximityFilter;
  sort: string;
  keyword: string;
  postedWithinDays: string;
  minPay: string;
  jobType: string;
  localCount: number;
  remoteCount: number;
  onClusterChange: (cluster: string) => void;
  onProximityChange: (proximity: JobProximityFilter) => void;
  onSortChange: (sort: string) => void;
  onKeywordChange: (value: string) => void;
  onPostedChange: (value: string) => void;
  onMinPayChange: (value: string) => void;
  onJobTypeChange: (value: string) => void;
}

const PROXIMITY_TABS: Array<{ value: JobProximityFilter; label: string }> = [
  { value: "local", label: "Local" },
  { value: "remote", label: "Remote" },
  { value: "all", label: "All" },
];

export function JobFilters({
  cluster,
  proximity,
  sort,
  keyword,
  postedWithinDays,
  minPay,
  jobType,
  localCount,
  remoteCount,
  onClusterChange,
  onProximityChange,
  onSortChange,
  onKeywordChange,
  onPostedChange,
  onMinPayChange,
  onJobTypeChange,
}: JobFiltersProps) {
  const safeCount = (value: number): number => (Number.isFinite(value) ? value : 0);
  const countFor = (value: JobProximityFilter): number => {
    const local = safeCount(localCount);
    const remote = safeCount(remoteCount);
    if (value === "local") return local;
    if (value === "remote") return remote;
    return local + remote;
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Filter jobs by location"
        className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-1"
      >
        {PROXIMITY_TABS.map((tab) => {
          const isSelected = proximity === tab.value;
          const count = countFor(tab.value);
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onProximityChange(tab.value)}
              className={`flex min-w-20 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                isSelected
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-full px-1.5 text-xs ${
                  isSelected
                    ? "bg-white/20 text-white"
                    : "bg-[var(--border)] text-[var(--text-secondary)]"
                }`}
                aria-label={`${count} ${tab.label.toLowerCase()} jobs`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <label className="sr-only" htmlFor="job-keyword">
        Search jobs by title, company, or keyword
      </label>
      <input
        id="job-keyword"
        type="search"
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        placeholder="Search title, company…"
        maxLength={100}
        className={`${CONTROL_CLASSES} w-full sm:w-auto sm:min-w-44`}
      />

      <label className="sr-only" htmlFor="job-posted">
        Filter jobs by date posted
      </label>
      <select
        id="job-posted"
        value={postedWithinDays}
        onChange={(e) => onPostedChange(e.target.value)}
        className={CONTROL_CLASSES}
      >
        {POSTED_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="job-pay">
        Filter jobs by minimum pay
      </label>
      <select
        id="job-pay"
        value={minPay}
        onChange={(e) => onMinPayChange(e.target.value)}
        className={CONTROL_CLASSES}
      >
        {MIN_PAY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="job-type">
        Filter jobs by job type
      </label>
      <select
        id="job-type"
        value={jobType}
        onChange={(e) => onJobTypeChange(e.target.value)}
        className={CONTROL_CLASSES}
      >
        {JOB_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="job-cluster">
        Filter jobs by career cluster
      </label>
      <select
        id="job-cluster"
        value={cluster}
        onChange={(e) => onClusterChange(e.target.value)}
        className={CONTROL_CLASSES}
      >
        {CLUSTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="job-sort">
        Sort jobs
      </label>
      <select
        id="job-sort"
        value={sort}
        onChange={(e) => onSortChange(e.target.value)}
        className={CONTROL_CLASSES}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
