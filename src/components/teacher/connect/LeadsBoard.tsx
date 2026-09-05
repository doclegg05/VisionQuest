import { SHIFT_LABELS, type LeadSchedule } from "@/lib/connect/leads-shared";

/**
 * The open leads, with how many students fit each one.
 *
 * Server-rendered and read-only — the numbers come from `summarizeLeadFits`
 * on the page, not from a fetch here. Mobile-first: one card per lead at
 * 375px, two columns from `md:` up, nothing that scrolls sideways.
 */

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
}

export function LeadsBoard({ leads }: { leads: LeadsBoardItem[] }) {
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
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {leads.map((lead) => (
          <li key={lead.id} className="theme-card-subtle rounded-lg p-4">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">{lead.title}</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{lead.employerName}</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{lead.location}</p>

            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {lead.pay ?? "Pay not listed."}
              {lead.shifts.length > 0 ? ` ${lead.shifts.map((shift) => SHIFT_LABELS[shift]).join(", ")}.` : ""}
            </p>

            <p className="mt-2 text-sm font-medium text-[var(--ink-strong)]">
              {lead.fitCount === null
                ? "Fit not counted."
                : `${lead.fitCount} fit / ${lead.blockedCount ?? 0} blocked`}
            </p>

            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              {lead.openings === 1 ? "1 opening" : `${lead.openings} openings`}
              {lead.className ? ` • ${lead.className}` : " • All classes"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
