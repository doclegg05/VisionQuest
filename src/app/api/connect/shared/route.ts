import { NextResponse } from "next/server";

import { forbidden, withAuth } from "@/lib/api-error";
import { listSharedWithEmployers } from "@/lib/connect/connections";
import { packetFieldList } from "@/lib/connect/packet-shared";
import { CONNECTION_STATUS_LABELS } from "@/lib/connect/pipeline-shared";

/**
 * GET /api/connect/shared — the student's own disclosure log, for the
 * "Shared with employers" section of /memory (Match & Connect Task 4.1).
 *
 * Only connections that were actually SENT: a proposal the student never
 * approved disclosed nothing, and listing it here would tell them their
 * information had gone somewhere it had not.
 *
 * Deliberately NOT gated on `connect_enabled_classes`: turning the pilot off
 * for a class must never hide from a student what was already shared about
 * them while it was on.
 */
export const GET = withAuth(async (session) => {
  if (session.role !== "student") {
    throw forbidden("Only students see their own sharing history.");
  }

  const rows = await listSharedWithEmployers(session.id);

  return NextResponse.json({
    success: true,
    data: {
      packets: rows.map((row) => ({
        id: row.id,
        employerName: row.employerName,
        jobTitle: row.jobTitle,
        sentOn: row.sentAt ? row.sentAt.slice(0, 10) : null,
        fields: row.packet ? packetFieldList(row.packet) : [],
        status: CONNECTION_STATUS_LABELS[row.status],
      })),
    },
  });
});
