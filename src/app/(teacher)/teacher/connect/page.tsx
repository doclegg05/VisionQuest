import Link from "next/link";
import { redirect } from "next/navigation";

import { AddLeadForm } from "@/components/teacher/connect/AddLeadForm";
import { BatchWorkforceButton } from "@/components/teacher/connect/BatchWorkforceButton";
import {
  EmployerDirectory,
  type EmployerDirectoryItem,
} from "@/components/teacher/connect/EmployerDirectory";
import {
  ConnectionsBoard,
  type ConnectionRow,
} from "@/components/teacher/connect/ConnectionsBoard";
import { LeadsBoard, type LeadsBoardItem } from "@/components/teacher/connect/LeadsBoard";
import {
  StudentsBoard,
  type StudentsBoardItem,
} from "@/components/teacher/connect/StudentsBoard";
import PageIntro from "@/components/ui/PageIntro";
import { isStaffRole } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { listConnectClasses } from "@/lib/connect/classes";
import { listEmployers } from "@/lib/connect/employers";
import { readSubsidyFlags } from "@/lib/connect/employers-shared";
import { listConnectionsForConsole } from "@/lib/connect/connections";
import { PACKET_FIELD_LABELS } from "@/lib/connect/packet-shared";
import { connectionStatusPhrase } from "@/lib/connect/pipeline-shared";
import { listLeads } from "@/lib/connect/leads";
import { describeLeadPay, parseLeadSchedule } from "@/lib/connect/leads-shared";
import { rankRoster, summarizeLeadFits } from "@/lib/connect/matching";
import { withRlsContext } from "@/lib/rls-context";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";

/**
 * /teacher/connect — the job developer console (Match & Connect Task 3.4).
 *
 * Three boards on one page: open leads with how many students fit each (and
 * who is blocked, behind a disclosure), students with their best leads, and
 * the employer directory. All three are computed on the server from shared
 * loads — `summarizeLeadFits` and `rankRoster` each read the roster once, so
 * the page costs a fixed handful of queries rather than one per row.
 *
 * Every student named on this page is a staff read of student data, so each
 * one is passed through `recordStudentView`, awaited via `allSettled` so the
 * record survives the response being sent without a failed sample ever being
 * able to break the page.
 *
 * Layout order is deliberate and has a gap in it: Phase 4's pipeline and
 * "follow-ups due today" belong ABOVE the boards, between the intro and
 * LeadsBoard, because they are the day's work rather than a directory. The
 * slot is marked below.
 *
 * Mobile-first: single column at 375px, two from `md:`, 44px touch targets,
 * nothing that scrolls sideways. Copy is at a 6th-grade reading level —
 * teacher surfaces are outside the readability gate's globs, so
 * ConnectBoards.test.tsx and AddLeadForm.test.tsx assert the key strings with
 * the same helper.
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

  const { leads, employers, roster, classes, connections } = await withRlsContext(
    rlsContext,
    async () => {
    const [openLeads, employerRows, rosterRows, classRows] = await Promise.all([
      listLeads({ status: "open", limit: MAX_BOARD_LEADS }),
      listEmployers(),
      rankRoster({ leadsPerStudent: 3 }),
      listConnectClasses(session),
    ]);

    // The pipeline board. Read inside the same RLS context as everything else
    // on this page, so `connection_read`'s managed_student_ids() gate decides
    // the roster rather than anything this page does.
    const connectionRows = await listConnectionsForConsole();

    const counts = await summarizeLeadFits(openLeads.map((lead) => lead.id));
    const countsByLead = new Map(counts.map((entry) => [entry.jobLeadId, entry]));

    return {
      leads: openLeads.map((lead): LeadsBoardItem => {
        const schedule = parseLeadSchedule(lead.schedule);
        const counted = countsByLead.get(lead.id);
        return {
          id: lead.id,
          title: lead.title,
          employerName: lead.employerName,
          location: lead.location,
          pay: describeLeadPay(lead),
          shifts: schedule.shifts,
          className: lead.class?.name ?? null,
          openings: lead.openings,
          fitCount: counted?.fitCount ?? null,
          blockedCount: counted?.blockedCount ?? null,
          blocked: counted?.blocked ?? [],
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
      connections: connectionRows.map(
        (row): ConnectionRow => ({
          id: row.id,
          studentName: row.studentName,
          jobTitle: row.jobTitle,
          employerName: row.employerName,
          status: row.status,
          statusPhrase: connectionStatusPhrase(row.status, row.employerName),
          fields: row.fields.map((key) => PACKET_FIELD_LABELS[key]),
          contactName: row.contactName,
          canSend: row.canSend,
          canClose: row.canClose,
        }),
      ),
    };
    },
  );

  // Every student named on this page is a staff read of student data, so the
  // audit sample is AWAITED rather than fired and forgotten. `recordStudentView`
  // swallows its own errors and `allSettled` never rejects, so a failed sample
  // still cannot stop the page rendering — but a request that is abandoned when
  // the response is sent would leave the read unrecorded, which is the one
  // outcome an audit trail may not have. It is sampled once per
  // actor/student/surface/day, so the steady-state cost is near zero.
  const namedStudents = new Set<string>([
    ...roster.map((entry) => entry.studentId),
    ...leads.flatMap((lead) => lead.blocked.map((student) => student.studentId)),
  ]);
  await Promise.allSettled(
    [...namedStudents].map((studentId) =>
      recordStudentView({
        actorId: session.id,
        actorRole: session.role,
        targetStudentId: studentId,
        surface: "student_detail",
      }),
    ),
  );

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Teacher tools"
        title="Connect"
        description="Open jobs, who fits each one, and the employers behind them. Add a lead by hand, from a job order (a job posted on WorkForce WV's job bank), or from a job on a class board."
      />

      <Link
        href="/teacher/connect/report"
        className="theme-card inline-block rounded-xl p-4 text-sm font-medium text-[var(--ink-strong)] hover:opacity-90"
      >
        See the funnel report — where connections stall, and the DoHS export →
      </Link>

      {/* Phase 4 slot: the connection pipeline and today's follow-ups go here,
          above the boards — they are the day's work, not a directory. */}

      <LeadsBoard leads={leads} />
      <ConnectionsBoard connections={connections} />
      <StudentsBoard students={roster} />
      <EmployerDirectory employers={employers} />

      <AddLeadForm
        employers={employers.map((employer) => ({ id: employer.id, name: employer.name }))}
        classes={classes}
        certifications={CERTIFICATIONS.map((cert) => ({ id: cert.id, label: cert.shortName }))}
      />

      <BatchWorkforceButton classes={classes} />
    </div>
  );
}
