import { SUBSIDY_KEYS, type SubsidyFlags } from "@/lib/connect/employers-shared";

/**
 * The employer directory: who owns the relationship, whether they have hired a
 * SPOKES graduate before, and which WV Works subsidies are known to apply.
 *
 * Subsidy flags are shown as "known" or "not asked" — never as a yes/no and
 * never with a dollar figure. The rule table behind those figures still needs
 * the local WV Works office's sign-off (plan P0.8), and a number on this screen
 * would end up quoted to an employer.
 */

export interface EmployerDirectoryItem {
  id: string;
  name: string;
  city: string;
  county: string;
  status: string;
  ownerName: string | null;
  lastHiredAt: string | null;
  hiredSpokesGradBefore: boolean;
  subsidyFlags: SubsidyFlags;
  openLeadCount: number;
}

const SUBSIDY_LABELS: Record<(typeof SUBSIDY_KEYS)[number], string> = {
  eip: "EIP",
  esp: "ESP",
  ojt: "OJT",
  wotc: "WOTC",
  bonding: "Bonding",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  do_not_contact: "Do not contact",
};

export function EmployerDirectory({ employers }: { employers: EmployerDirectoryItem[] }) {
  if (employers.length === 0) {
    return (
      <div className="theme-card rounded-xl p-5">
        <h2 className="text-base font-semibold text-[var(--ink-strong)]">Employers</h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          No employers yet. Adding a lead adds its employer too.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="employer-directory-heading" className="theme-card rounded-xl p-5">
      <h2
        id="employer-directory-heading"
        className="text-base font-semibold text-[var(--ink-strong)]"
      >
        Employers ({employers.length})
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {employers.map((employer) => {
          const known = SUBSIDY_KEYS.filter((key) => employer.subsidyFlags[key] === "known");
          return (
            <li key={employer.id} className="theme-card-subtle rounded-lg p-4">
              <p className="text-sm font-semibold text-[var(--ink-strong)]">{employer.name}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {employer.city}, {employer.county} County
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {STATUS_LABELS[employer.status] ?? employer.status}
                {employer.openLeadCount > 0 ? ` • ${employer.openLeadCount} open` : ""}
              </p>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Owner: {employer.ownerName ?? "Not set"}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {employer.hiredSpokesGradBefore
                  ? `Hired one of ours${employer.lastHiredAt ? ` on ${employer.lastHiredAt}` : ""}.`
                  : "Has not hired one of ours yet."}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {known.length > 0
                  ? `Wage help we know about: ${known.map((key) => SUBSIDY_LABELS[key]).join(", ")}.`
                  : "Wage help: not asked yet."}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
