// =============================================================================
// The DoHS-facing statistical export — Prisma reads.
//
// Match & Connect Phase 6, Task 6.2. `dohs-export-shared.ts` does the row
// mapping and CSV formatting; this module fetches SpokesRecord + its
// placement Application + that Application's Connection (when the placement
// traces to one), scoped to the instructor's managed students exactly like
// `funnel.ts`.
// =============================================================================

import type { Session } from "@/lib/api-error";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";

import { buildDohsExportRows, type DohsExportRow } from "./dohs-export-shared";

export interface FetchDohsExportOptions {
  classId?: string;
  from?: string;
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
    await assertStaffCanManageClass(session, options.classId);
  }

  const studentIds = await listManagedStudentIds(session, {
    classId: options.classId,
    includeInactiveAccounts: true,
  });

  if (studentIds.length === 0) {
    return { rows: [], studentIds: [] };
  }

  const from = options.from ? new Date(options.from) : undefined;
  const to = options.to ? new Date(options.to) : undefined;

  const records = await prisma.spokesRecord.findMany({
    where: {
      studentId: { in: studentIds },
      ...(from || to
        ? {
            enrolledAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
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
          classEnrollments: {
            where: { status: "active" },
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
              status: true,
              packet: true,
              jobLead: { select: { schedule: true } },
            },
          },
        },
      },
      employmentFollowUps: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        select: { checkedAt: true },
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
                  status: record.placementApplication.connection.status,
                  packet: record.placementApplication.connection.packet,
                  jobLeadSchedule: record.placementApplication.connection.jobLead.schedule,
                }
              : null,
          }
        : null,
      latestFollowUpAt: record.employmentFollowUps[0]?.checkedAt ?? null,
    })),
  );

  return {
    rows,
    studentIds: records.flatMap((record) => (record.studentId ? [record.studentId] : [])),
  };
}
