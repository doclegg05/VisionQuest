// =============================================================================
// The Connect funnel — Prisma reads.
//
// Match & Connect Phase 6, Task 6.1. `funnel-shared.ts` does the aggregation;
// this module fetches the rows it needs.
//
// Scoping: `connectManagedStudentIds` (./classes), NOT `classroom.ts`'s
// `listManagedStudentIds` — see that function's header (SEC-W1, 2026-09
// review). It mirrors `managed_student_ids()`, the Postgres function
// `Connection`/`Application` RLS actually calls, for both the classId and
// no-classId cases; `assertClassIsManaged` (not the broader
// `assertStaffCanManageClass`) gives a clear 404 on a classId the caller
// does not instruct, instead of a query that RLS would have silently
// emptied anyway.
//
// Three queries total — Connection, ConnectionEvent, and the self-directed
// Application comparison — no N+1. `from`/`to` bounds are pushed into the
// Connection/Application WHERE clauses (not just applied in-memory by
// computeFunnel) so the event query, built from the already-period-scoped
// connection ids, never has to look at events outside the window either.
// =============================================================================

import type { Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { reportDateRangeBoundsUtc } from "@/lib/timezone";

import { assertClassIsManaged, connectManagedStudentIds } from "./classes";
import { computeFunnel, type FunnelResult } from "./funnel-shared";

export interface FetchFunnelOptions {
  classId?: string;
  employerId?: string;
  /** "YYYY-MM-DD" — resolved to ET-aware UTC instants via reportDateRangeBoundsUtc. */
  from?: string;
  /** "YYYY-MM-DD" — resolved to the EXCLUSIVE start of the ET day after. */
  to?: string;
}

export async function fetchConnectFunnel(
  session: Session,
  options: FetchFunnelOptions = {},
): Promise<FunnelResult> {
  if (options.classId) {
    await assertClassIsManaged(options.classId, session);
  }

  const studentIds = await connectManagedStudentIds(session, options.classId);

  const { from, to } = reportDateRangeBoundsUtc(options.from, options.to);

  if (studentIds.length === 0) {
    return computeFunnel([], [], { from, to });
  }

  const createdAtWhere =
    from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
      : {};

  const connections = await prisma.connection.findMany({
    where: {
      studentId: { in: studentIds },
      ...(options.employerId ? { employerId: options.employerId } : {}),
      // A class filter must not hide PROGRAM-WIDE leads (classId null) —
      // those are visible to every class's students, so their connections
      // belong in every class's funnel too (W3, 2026-09 review). Dropping
      // this OR would silently zero out any program-wide lead's numbers the
      // moment a teacher filters by class.
      ...(options.classId
        ? { jobLead: { OR: [{ classId: options.classId }, { classId: null }] } }
        : {}),
      ...createdAtWhere,
    },
    select: {
      id: true,
      studentId: true,
      employerId: true,
      status: true,
      createdAt: true,
      sentAt: true,
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
      ...createdAtWhere,
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
      hiredAt: connection.hiredAt,
      packet: connection.packet,
    })),
    events,
    { from, to, selfDirectedApplications },
  );
}
