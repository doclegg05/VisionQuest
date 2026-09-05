import { NextResponse } from "next/server";

import { forbidden, withAuth } from "@/lib/api-error";
import { listPendingForStudent } from "@/lib/connect/connections";
import { isConnectEnabledForStudent } from "@/lib/connect/flags";
import { packetFieldList } from "@/lib/connect/packet-shared";

/**
 * GET /api/connect/pending — the introductions waiting on this student's tap
 * (Match & Connect Task 4.3).
 *
 * Student-own by construction and by RLS. The response carries the packet's
 * FIELD LIST rather than the packet, because that is what the approval card
 * shows and there is no reason to put the endorsement text or a résumé id in
 * a payload the card does not render.
 */
export const GET = withAuth(async (session) => {
  if (session.role !== "student") {
    throw forbidden("Only students see their own introductions.");
  }
  if (!(await isConnectEnabledForStudent(session.id))) {
    // Off for this class: an empty list, not an error. The page renders
    // nothing and the student is never told about a feature they cannot use.
    return NextResponse.json({ success: true, data: { pending: [] } });
  }

  const pending = await listPendingForStudent(session.id);

  return NextResponse.json({
    success: true,
    data: {
      pending: pending.map((row) => ({
        id: row.id,
        jobTitle: row.jobTitle,
        location: row.location,
        employerName: row.employerName,
        fields: row.packet ? packetFieldList(row.packet) : [],
        endorsement: row.packet?.endorsement ?? "",
      })),
    },
  });
});
