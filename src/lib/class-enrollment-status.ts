import { prisma } from "@/lib/db";

export const VALID_ENROLLMENT_STATUSES = ["active", "inactive", "completed", "withdrawn", "archived"] as const;

export type EnrollmentStatus = (typeof VALID_ENROLLMENT_STATUSES)[number];

export interface EnrollmentStatusUpdate {
  readonly where: { readonly id: string };
  readonly data: { readonly status: EnrollmentStatus; readonly archivedAt: Date | null; readonly archiveReason: string | null };
  readonly select: {
    readonly id: true;
    readonly studentId: true;
    readonly status: true;
    readonly archivedAt: true;
    readonly archiveReason: true;
  };
}

/** What the route sends back about the enrollment it changed. */
export interface EnrollmentStatusResult {
  readonly id: string;
  readonly status: string;
  readonly archivedAt: Date | null;
  readonly archiveReason: string | null;
}

/**
 * The update a teacher's status change makes. The write-through on `prisma`
 * finds the student to clear in the row this returns, so `select` must keep
 * `studentId`: without it the write names no student and clears everyone.
 */
export function enrollmentStatusUpdateArgs(enrollmentId: string, status: EnrollmentStatus, archiveReason: string): EnrollmentStatusUpdate {
  const archived = status === "archived";
  return {
    where: { id: enrollmentId },
    data: {
      status,
      archivedAt: archived ? new Date() : null,
      archiveReason: archived ? archiveReason || null : null,
    },
    select: {
      id: true,
      studentId: true,
      status: true,
      archivedAt: true,
      archiveReason: true,
    },
  };
}

/** Sets one enrollment's status. The response keeps the fields the route has always sent. */
export async function updateEnrollmentStatus(
  enrollmentId: string,
  status: EnrollmentStatus,
  archiveReason: string,
): Promise<EnrollmentStatusResult> {
  const { id, status: saved, archivedAt, archiveReason: reason } = await prisma.studentClassEnrollment.update(
    enrollmentStatusUpdateArgs(enrollmentId, status, archiveReason),
  );
  return { id, status: saved, archivedAt, archiveReason: reason };
}
