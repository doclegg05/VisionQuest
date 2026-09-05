// =============================================================================
// The DoHS-facing statistical export — Prisma reads.
//
// Match & Connect Phase 6, Task 6.2. `dohs-export-shared.ts` does the row
// mapping and CSV formatting; this module fetches SpokesRecord + its
// placement Application + that Application's Connection (when the placement
// traces to one) and every SpokesEmploymentFollowUp for the record (C1's
// retention derivation needs every "employed" checkpoint's date, not just
// the latest), plus — only when a connect-sourced connection exists — its
// full ConnectionEvent history (C1's fallback for a record with no
// follow-up at all).
//
// SEC-W4 (2026-09 security review) — legal basis for this disclosure: this
// export is program-administration statistical reporting to the SPOKES
// grant's state funder (DoHS/WVDE), not a third-party employer referral. It
// does not use, and must never gate on, the `employer_referral` consent
// scope `workforce-batch-query.ts` checks — that scope covers disclosing a
// STUDENT'S IDENTITY to an EMPLOYER, a different disclosure with a different
// legal basis than aggregate program reporting to the funder that requires
// it as a condition of the grant. See `docs/DATA_RETENTION_POLICY.md`'s
// reporting-disclosures note.
//
// Scoping: `connectManagedStudentIds` (./classes), NOT `classroom.ts`'s
// `listManagedStudentIds` — see that function's header (SEC-W1).
// `assertClassIsManaged` (not `assertStaffCanManageClass`) gives a clear
// 404 on a classId the caller does not instruct.
// =============================================================================

import type { Session } from "@/lib/api-error";
import { NON_ARCHIVED_ENROLLMENT_STATUSES } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { reportDateRangeBoundsUtc } from "@/lib/timezone";

import { assertClassIsManaged, connectManagedStudentIds } from "./classes";
import { buildDohsExportRows, type DohsExportRow } from "./dohs-export-shared";

export interface FetchDohsExportOptions {
  classId?: string;
  /** "YYYY-MM-DD" — resolved to ET-aware UTC instants via reportDateRangeBoundsUtc. */
  from?: string;
  /** "YYYY-MM-DD" — resolved to the EXCLUSIVE start of the ET day after. */
  to?: string;
}

export interface DohsExportResult {
  rows: DohsExportRow[];
  /** Student.id for every row that carries a spokesId — for `recordStudentView`. */
  studentIds: string[];
}

export async function fetchDohsExport(
  session: Session,
  options: FetchDohsExportOptions = {},
): Promise<DohsExportResult> {
  if (options.classId) {
    await assertClassIsManaged(options.classId, session);
  }

  const studentIds = await connectManagedStudentIds(session, options.classId);

  if (studentIds.length === 0) {
    return { rows: [], studentIds: [] };
  }

  const { from, to } = reportDateRangeBoundsUtc(options.from, options.to);

  const records = await prisma.spokesRecord.findMany({
    where: {
      studentId: { in: studentIds },
      ...(from || to
        ? {
            enrolledAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
    },
    select: {
      studentId: true,
      enrolledAt: true,
      exitDate: true,
      unsubsidizedEmploymentAt: true,
      employerName: true,
      hourlyWage: true,
      student: {
        select: {
          studentId: true,
          // NON_ARCHIVED_ENROLLMENT_STATUSES (not "active" alone, W9): a
          // graduate's enrollment is "completed", and excluding that status
          // left the Class column blank for every graduate the export names.
          classEnrollments: {
            where: { status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] } },
            orderBy: { enrolledAt: "desc" },
            take: 1,
            select: { class: { select: { name: true } } },
          },
        },
      },
      placementApplication: {
        select: {
          verificationStatus: true,
          connection: {
            select: {
              packet: true,
              jobLead: { select: { schedule: true } },
              events: { select: { toStatus: true } },
            },
          },
        },
      },
      // Every follow-up (not `take: 1`) — C1's retention derivation checks
      // every "employed" checkpoint's date against the employment start
      // date, not only the most recent row.
      employmentFollowUps: {
        select: { checkpointMonths: true, status: true, checkedAt: true },
      },
    },
    orderBy: { enrolledAt: "asc" },
  });

  const rows = buildDohsExportRows(
    records.map((record) => ({
      spokesId: record.student?.studentId ?? null,
      className: record.student?.classEnrollments[0]?.class.name ?? null,
      enrollmentDate: record.enrolledAt,
      exitDate: record.exitDate,
      unsubsidizedEmploymentAt: record.unsubsidizedEmploymentAt,
      employerName: record.employerName,
      hourlyWage: record.hourlyWage,
      placementApplication: record.placementApplication
        ? {
            verificationStatus: record.placementApplication.verificationStatus,
            connection: record.placementApplication.connection
              ? {
                  packet: record.placementApplication.connection.packet,
                  jobLeadSchedule: record.placementApplication.connection.jobLead.schedule,
                  eventToStatuses: record.placementApplication.connection.events.map(
                    (event) => event.toStatus,
                  ),
                }
              : null,
          }
        : null,
      employmentFollowUps: record.employmentFollowUps,
    })),
  );

  return {
    rows,
    studentIds: records.flatMap((record) => (record.studentId ? [record.studentId] : [])),
  };
}
