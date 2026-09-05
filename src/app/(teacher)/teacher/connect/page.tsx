import { redirect } from "next/navigation";

import { AddLeadForm } from "@/components/teacher/connect/AddLeadForm";
import {
  EmployerDirectory,
  type EmployerDirectoryItem,
} from "@/components/teacher/connect/EmployerDirectory";
import { LeadsBoard, type LeadsBoardItem } from "@/components/teacher/connect/LeadsBoard";
import {
  StudentsBoard,
  type StudentsBoardItem,
} from "@/components/teacher/connect/StudentsBoard";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { recordStudentView } from "@/lib/audit";
import { isStaffRole } from "@/lib/api-error";
import { listManagedClasses } from "@/lib/classroom";
import { listEmployers } from "@/lib/connect/employers";
import { readSubsidyFlags } from "@/lib/connect/employers-shared";
import { describeLeadPay, parseLeadSchedule } from "@/lib/connect/leads-shared";
import { listLeads } from "@/lib/connect/leads";
import { rankRoster, summarizeLeadFits } from "@/lib/connect/matching";
import { withRlsContext } from "@/lib/rls-context";

/**
 * /teacher/connect — the job developer console (Match & Connect Task 3.4).
 *
 * Three boards on one page: open leads with how many students fit each,
 * students with their best leads, and the employer directory. All three are
 * computed on the server from shared loads — `summarizeLeadFits` and
 * `rankRoster` each read the roster once, so the page costs a fixed handful of
 * queries rather than one per row.
 *
 * Every student named on this page is a staff read of student data, so each
 * one is passed through `recordStudentView`. That is the rule in
 * .claude/rules/security.md, and this page is exactly the surface it was
 * written for.
 *
 * The layout is mobile-first: single column at 375px, two from `md:`, 44px
 * touch targets, and nothing that scrolls sideways. Copy is at a 6th-grade
 * reading level — teacher surfaces are outside the readability gate's globs,
 * so ConnectCopy.test.tsx asserts the key strings with the same helper.
 */

export const dynamic = "force-dynamic";

/** Leads shown on the board and used for the roster's best-lead shortlist. */
const MAX_BOARD_LEADS = 50;

export default async function ConnectPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isStaffRole(session.role)) redirect("/dashboard");

  const rlsContext = {
    userId: session.id,
    role: session.role === "admin" ? ("admin" as const) : ("teacher" as const),
    studentId: "",
  };

  const { leads, employers, roster, classes } = await withRlsContext(rlsContext, async () => {
    const [openLeads, employerRows, rosterRows, classRows] = await Promise.all([
      listLeads({ status: "open", limit: MAX_BOARD_LEADS }),
      listEmployers(),
      rankRoster({ leadsPerStudent: 3 }),
      listManagedClasses(session),
    ]);

    const counts = await summarizeLeadFits(openLeads.map((lead) => lead.id));
    const countsByLead = new Map(counts.map((entry) => [entry.jobLeadId, entry]));

    return {
      leads: openLeads.map((lead): LeadsBoardItem => {
        const schedule = parseLeadSchedule(lead.schedule);
        return {
          id: lead.id,
          title: lead.title,
          employerName: lead.employer.name,
          location: lead.location,
          pay: describeLeadPay(lead),
          shifts: schedule.shifts,
          className: lead.class?.name ?? null,
          openings: lead.openings,
          fitCount: countsByLead.get(lead.id)?.fitCount ?? null,
          blockedCount: countsByLead.get(lead.id)?.blockedCount ?? null,
        };
      }),
      employers: employerRows.map(
        (employer): EmployerDirectoryItem => ({
          id: employer.id,
          name: employer.name,
          city: employer.city,
          county: employer.county,
          status: employer.status,
          ownerName: employer.relationshipOwner?.displayName ?? null,
          lastHiredAt: employer.lastHiredAt
            ? employer.lastHiredAt.toISOString().slice(0, 10)
            : null,
          hiredSpokesGradBefore: employer.hiredSpokesGradBefore,
          subsidyFlags: readSubsidyFlags(employer.subsidyFlags),
          openLeadCount: employer._count.jobLeads,
        }),
      ),
      roster: rosterRows.map(
        (entry): StudentsBoardItem => ({
          studentId: entry.studentId,
          displayName: entry.displayName,
          leads: entry.leads.map((lead) => ({
            jobLeadId: lead.jobLeadId,
            title: lead.title,
            employerName: lead.employerName,
            reasons: lead.reasons,
          })),
        }),
      ),
      classes: classRows.map((row) => ({ id: row.id, name: row.name })),
    };
  });

  // Fire-and-forget: an audit failure must never stop the page from rendering,
  // and recordStudentView already swallows its own errors.
  await Promise.allSettled(
    roster.map((entry) =>
      recordStudentView({
        actorId: session.id,
        actorRole: session.role,
        targetStudentId: entry.studentId,
        surface: "student_detail",
      }),
    ),
  );

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Teacher tools"
        title="Connect"
        description="Open jobs, who fits each one, and the employers behind them. Add a lead by hand, from a job order, or from a job on a class board."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--ink-muted)]">
          Send this week&rsquo;s ready students to WorkForce WV as one file.
        </p>
        <a
          href="/api/teacher/connect/batch-workforce-wv"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)]"
        >
          Batch to WorkForce WV
        </a>
      </div>

      <LeadsBoard leads={leads} />
      <StudentsBoard students={roster} />
      <EmployerDirectory employers={employers} />
      <AddLeadForm
        employers={employers.map((employer) => ({ id: employer.id, name: employer.name }))}
        classes={classes}
      />
    </div>
  );
}
