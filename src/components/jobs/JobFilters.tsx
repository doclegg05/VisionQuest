"use client";

import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

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

const VISIBLE_LABEL_CLASSES = "text-sm font-medium text-[var(--text-secondary)]";

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

  // UX finding #4 (2026-09-07 fluidity memo): 9 controls in one flex-wrap
  // row, every select labeled sr-only-only, wrapped into 4-5 look-alike
  // rows at 375px. Proximity + search stay always visible; the four
  // secondary filters collapse behind this disclosure. Seeded open when a
  // secondary filter already has a value (UX review WARNING) so an applied
  // filter is never hidden from the student who set it on first paint.
  const [filtersOpen, setFiltersOpen] = useState(
    () => [postedWithinDays, minPay, jobType, cluster].some(Boolean),
  );
  const activeSecondaryCount = [postedWithinDays, minPay, jobType, cluster].filter(Boolean).length;

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
              className={`flex min-h-11 min-w-20 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
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

      <div className="flex flex-col gap-1">
        <label className={VISIBLE_LABEL_CLASSES} htmlFor="job-sort">
          Sort by
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

      <button
        type="button"
        aria-expanded={filtersOpen}
        aria-controls="job-filters-panel"
        onClick={() => setFiltersOpen((current) => !current)}
        className="flex min-h-11 items-center gap-1.5 self-end rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--primary)]"
      >
        Filters{activeSecondaryCount > 0 ? ` (${activeSecondaryCount})` : ""}
        <CaretDown
          size={14}
          aria-hidden="true"
          className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}
        />
      </button>

      <div
        id="job-filters-panel"
        hidden={!filtersOpen}
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4"
      >
        <div className="flex flex-col gap-1">
          <label className={VISIBLE_LABEL_CLASSES} htmlFor="job-posted">
            Posted
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
        </div>

        <div className="flex flex-col gap-1">
          <label className={VISIBLE_LABEL_CLASSES} htmlFor="job-pay">
            Pay
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
        </div>

        <div className="flex flex-col gap-1">
          <label className={VISIBLE_LABEL_CLASSES} htmlFor="job-type">
            Job type
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
        </div>

        <div className="flex flex-col gap-1">
          <label className={VISIBLE_LABEL_CLASSES} htmlFor="job-cluster">
            Career area
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
        </div>
      </div>
    </div>
  );
}
