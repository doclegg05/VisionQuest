"use client";

import { useMemo, useState } from "react";

import { SHIFT_LABELS, type LeadSchedule } from "@/lib/connect/leads-shared";

import { BoardFilter, ShowMore, useBoardPaging } from "./BoardControls";

/**
 * The open leads, with how many students fit each one and — behind a
 * disclosure — who is blocked and why.
 *
 * The blocked list is the point of the reverse match: `fit()` already produces
 * a grade-6 sentence per blocked student, and until this shipped nothing ever
 * showed it, so an instructor could see "4 fit / 12 blocked" with no way to
 * learn that eleven of the twelve just need one certificate.
 *
 * Client component only for the filter and the collapse; every number arrives
 * as a prop, computed on the server.
 */

export interface BlockedStudentItem {
  studentId: string;
  displayName: string;
  reason: string;
}

export interface LeadsBoardItem {
  id: string;
  title: string;
  employerName: string;
  location: string;
  pay: string | null;
  shifts: LeadSchedule["shifts"];
  className: string | null;
  openings: number;
  fitCount: number | null;
  blockedCount: number | null;
  /** The first few blocked students; the rest are summarised. */
  blocked: BlockedStudentItem[];
}

export function LeadsBoard({ leads }: { leads: LeadsBoardItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter(
      (lead) =>
        lead.title.toLowerCase().includes(needle) ||
        lead.employerName.toLowerCase().includes(needle),
    );
  }, [leads, query]);

  const { visible, hiddenCount, expanded, expand } = useBoardPaging(filtered);

  if (leads.length === 0) {
    return (
      <div className="theme-card rounded-xl p-5">
        <h2 className="text-base font-semibold text-[var(--ink-strong)]">Open leads</h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          No open leads yet. Add one below, or turn a job on a class board into a lead.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="leads-board-heading" className="theme-card rounded-xl p-5">
      <h2 id="leads-board-heading" className="text-base font-semibold text-[var(--ink-strong)]">
        Open leads ({leads.length})
      </h2>

      <BoardFilter
        id="leads-filter"
        label="Find a lead"
        hint="Type a job title or an employer."
        value={query}
        onChange={setQuery}
      />

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">No lead matches that.</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {visible.map((lead) => (
            <li key={lead.id} className="theme-card-subtle rounded-lg p-4">
              <p className="text-sm font-semibold text-[var(--ink-strong)]">{lead.title}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{lead.employerName}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{lead.location}</p>

              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                {lead.pay ?? "Pay not listed."}
                {lead.shifts.length > 0
                  ? ` ${lead.shifts.map((shift) => SHIFT_LABELS[shift]).join(", ")}.`
                  : ""}
              </p>

              <p className="mt-2 text-sm font-medium text-[var(--ink-strong)]">
                {lead.fitCount === null
                  ? "Fit not counted."
                  : `${lead.fitCount} fit / ${lead.blockedCount ?? 0} blocked`}
              </p>

              {lead.blocked.length > 0 && (
                <details className="mt-2">
                  <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-[var(--ink-strong)]">
                    Who is blocked, and why
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {lead.blocked.map((student) => (
                      <li key={student.studentId} className="text-sm text-[var(--ink-muted)]">
                        {student.displayName}: {student.reason}
                      </li>
                    ))}
                    {lead.blockedCount !== null && lead.blockedCount > lead.blocked.length && (
                      <li className="text-sm text-[var(--ink-muted)]">
                        and {lead.blockedCount - lead.blocked.length} more
                      </li>
                    )}
                  </ul>
                </details>
              )}

              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                {lead.openings === 1 ? "1 opening" : `${lead.openings} openings`}
                {lead.className ? ` • ${lead.className}` : " • All classes"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <ShowMore hiddenCount={hiddenCount} expanded={expanded} onExpand={expand} noun="leads" />
    </section>
  );
}
