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

export type JobProximityFilter = "local" | "remote" | "all";

interface JobFiltersProps {
  cluster: string;
  proximity: JobProximityFilter;
  sort: string;
  localCount: number;
  remoteCount: number;
  onClusterChange: (cluster: string) => void;
  onProximityChange: (proximity: JobProximityFilter) => void;
  onSortChange: (sort: string) => void;
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
  localCount,
  remoteCount,
  onClusterChange,
  onProximityChange,
  onSortChange,
}: JobFiltersProps) {
  const countFor = (value: JobProximityFilter): number => {
    if (value === "local") return localCount;
    if (value === "remote") return remoteCount;
    return localCount + remoteCount;
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

      <select
        value={cluster}
        onChange={(e) => onClusterChange(e.target.value)}
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm"
      >
        {CLUSTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value)}
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm"
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
