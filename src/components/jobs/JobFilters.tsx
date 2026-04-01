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

const TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "job", label: "Jobs" },
  { value: "training", label: "Training" },
  { value: "apprenticeship", label: "Apprenticeship" },
];

interface JobFiltersProps {
  cluster: string;
  opportunityType: string;
  sort: string;
  onClusterChange: (cluster: string) => void;
  onOpportunityTypeChange: (type: string) => void;
  onSortChange: (sort: string) => void;
}

export function JobFilters({
  cluster,
  opportunityType,
  sort,
  onClusterChange,
  onOpportunityTypeChange,
  onSortChange,
}: JobFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
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
        value={opportunityType}
        onChange={(e) => onOpportunityTypeChange(e.target.value)}
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm"
      >
        {TYPE_OPTIONS.map((opt) => (
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
