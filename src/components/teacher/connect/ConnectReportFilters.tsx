"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * The Connect report's filter bar (Match & Connect Task 6.1).
 *
 * Deliberately the only "use client" piece of the report page: it just
 * navigates to `?classId=&employerId=&from=&to=` on submit, so the page
 * itself stays a server component that reads those params straight from
 * `searchParams` and re-fetches. No fetch happens here.
 */
export interface ConnectReportFiltersOption {
  id: string;
  name: string;
}

export interface ConnectReportFiltersProps {
  classes: ConnectReportFiltersOption[];
  employers: ConnectReportFiltersOption[];
  initial: {
    classId?: string;
    employerId?: string;
    from?: string;
    to?: string;
  };
}

export function ConnectReportFilters({ classes, employers, initial }: ConnectReportFiltersProps) {
  const router = useRouter();
  const [classId, setClassId] = useState(initial.classId ?? "");
  const [employerId, setEmployerId] = useState(initial.employerId ?? "");
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (classId) params.set("classId", classId);
    if (employerId) params.set("employerId", employerId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    router.push(query ? `/teacher/connect/report?${query}` : "/teacher/connect/report");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="theme-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-strong)]">Class</span>
        <select
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          className="theme-card-subtle min-h-11 rounded-lg px-2 py-2"
        >
          <option value="">All classes</option>
          {classes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-strong)]">Employer</span>
        <select
          value={employerId}
          onChange={(event) => setEmployerId(event.target.value)}
          className="theme-card-subtle min-h-11 rounded-lg px-2 py-2"
        >
          <option value="">All employers</option>
          {employers.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-strong)]">From</span>
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="theme-card-subtle min-h-11 rounded-lg px-2 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-strong)]">To</span>
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="theme-card-subtle min-h-11 rounded-lg px-2 py-2"
        />
      </label>

      <button
        type="submit"
        className="theme-card-subtle min-h-11 rounded-lg px-4 py-2 font-medium hover:opacity-90"
      >
        Apply filters
      </button>
    </form>
  );
}
