// =============================================================================
// The Connect funnel — Prisma reads.
//
// Match & Connect Phase 6, Task 6.1. `funnel-shared.ts` does the aggregation;
// this module fetches the rows it needs, scoped to the instructor's managed
// students (`Connection` RLS already restricts a teacher to
// `managed_student_ids()`, so this is belt-and-suspenders scoping via the
// same helper every other teacher report uses, and it is what makes the
// `classId`/`employerId` filters meaningful narrowing rather than only an
// authorization boundary).
//
// Three queries total — Connection, ConnectionEvent, and the self-directed
// Application comparison — no N+1.
// =============================================================================

import type { Session } from "@/lib/api-error";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";

import { computeFunnel, type FunnelResult } from "./funnel-shared";

export interface FetchFunnelOptions {
  classId?: string;
  employerId?: string;
  from?: string;
  to?: string;
}

export async function fetchConnectFunnel(
  session: Session,
  options: FetchFunnelOptions = {},
): Promise<FunnelResult> {
  if (options.classId) {
    await assertStaffCanManageClass(session, options.classId);
  }

  const studentIds = await listManagedStudentIds(session, {
    classId: options.classId,
    includeInactiveAccounts: true,
  });

  if (studentIds.length === 0) {
    return computeFunnel([], [], { from: options.from, to: options.to });
  }

  const connections = await prisma.connection.findMany({
    where: {
      studentId: { in: studentIds },
      ...(options.employerId ? { employerId: options.employerId } : {}),
      ...(options.classId ? { jobLead: { classId: options.classId } } : {}),
    },
    select: {
      id: true,
      studentId: true,
      employerId: true,
      status: true,
      createdAt: true,
      sentAt: true,
      employerRespondedAt: true,
      hiredAt: true,
      packet: true,
      employer: { select: { name: true } },
      jobLead: { select: { classId: true, class: { select: { name: true } } } },
    },
  });

  const connectionIds = connections.map((connection) => connection.id);
  const events =
    connectionIds.length === 0
      ? []
      : await prisma.connectionEvent.findMany({
          where: { connectionId: { in: connectionIds } },
          select: { connectionId: true, toStatus: true, at: true },
        });

  // Same period, same classes, no Connection link — the plan's comparison
  // line. `connection: null` catches both "never proposed" and a proposal
  // that failed before the row existed; either way it is self-directed.
  const selfDirectedApplications = await prisma.application.findMany({
    where: {
      studentId: { in: studentIds },
      connection: null,
    },
    select: { id: true, studentId: true, createdAt: true, status: true, verificationStatus: true },
  });

  return computeFunnel(
    connections.map((connection) => ({
      id: connection.id,
      studentId: connection.studentId,
      employerId: connection.employerId,
      employerName: connection.employer.name,
      classId: connection.jobLead.classId,
      className: connection.jobLead.class?.name ?? null,
      status: connection.status,
      createdAt: connection.createdAt,
      sentAt: connection.sentAt,
      employerRespondedAt: connection.employerRespondedAt,
      hiredAt: connection.hiredAt,
      packet: connection.packet,
    })),
    events,
    { from: options.from, to: options.to, selfDirectedApplications },
  );
}
