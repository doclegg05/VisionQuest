import { NextResponse } from "next/server";

import { forbidden, withAuth } from "@/lib/api-error";
import {
  ConnectionError,
  approveConnection,
  connectionProvenance,
} from "@/lib/connect/connections";
import { isConnectEnabledForStudent } from "@/lib/connect/flags";
import { packetFieldList } from "@/lib/connect/packet-shared";
import { operationIdFor, recordOperation } from "@/lib/sage/operations";

/**
 * POST /api/connect/[id]/approve — the student's tap (Match & Connect Task
 * 4.3, design spec §6 step 2).
 *
 * This is the consent event. It writes the `employer_referral` consent if it
 * is not already active, freezes the packet, and moves the connection to
 * `student_approved`. Nothing reaches an employer until an instructor then
 * sends, and Sage can never take this step: the route requires a student
 * session and acts only on that student's own row.
 *
 * The body is empty by design — approving carries no options, because an
 * option would mean the card showed something other than what is sent. CSRF
 * still applies: it is a POST to /api/* and passes the origin check in
 * middleware like every other mutating route.
 */
export const POST = withAuth(
  async (session, _req: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    if (session.role !== "student") {
      throw forbidden("Only the student can approve their own introduction.");
    }
    if (!(await isConnectEnabledForStudent(session.id))) {
      return NextResponse.json(
        { error: "That isn't turned on for your class yet." },
        { status: 403 },
      );
    }

    // Read before the write so the SageOperation below can be attributed only
    // when Sage actually raised the proposal.
    const before = await connectionProvenance(id, session.id);

    try {
      const packet = await approveConnection(id, session.id);

      if (before?.proposedVia === "sage") {
        // The ledger row closes the loop the write tool opened: Sage proposed,
        // the student approved, and the operation viewer shows both halves.
        const now = new Date();
        await recordOperation({
          id: operationIdFor(`propose_connection-approved-${id}`, now),
          actorType: "student",
          actorId: session.id,
          actorRole: session.role,
          targetStudentId: session.id,
          toolName: "propose_connection",
          status: "executed",
          payload: { connectionId: id, jobLeadId: before.jobLeadId } as never,
          resultSummary: "The student approved what would be shared with the employer.",
        }).catch(() => undefined);
      }

      return NextResponse.json({
        success: true,
        data: { id, status: "student_approved", fields: packetFieldList(packet) },
      });
    } catch (error) {
      if (error instanceof ConnectionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },
);
