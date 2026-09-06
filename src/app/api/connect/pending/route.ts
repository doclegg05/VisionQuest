import { NextResponse } from "next/server";

import { forbidden, withAuth } from "@/lib/api-error";
import {
  listActiveForStudent,
  listPendingForStudent,
} from "@/lib/connect/connections";
import { isConnectEnabledForStudent } from "@/lib/connect/flags";
import { connectionStatusPhrase } from "@/lib/connect/pipeline-shared";

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
    return NextResponse.json({ success: true, data: { pending: [], active: [] } });
  }

  const [pending, active] = await Promise.all([
    listPendingForStudent(session.id),
    listActiveForStudent(session.id),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      // Waiting on their tap. The card renders the packet's REAL VALUES, not
      // just the field labels: the employer page shows the availability, the
      // start date, the cert names and the endorsement, and a student cannot
      // give informed consent to a list of categories whose contents they have
      // not seen.
      pending: pending.map((row) => ({
        id: row.id,
        jobTitle: row.jobTitle,
        location: row.location,
        employerName: row.employerName,
        // KEYS, not labels. The card renders the label for each key from the
        // same PACKET_FIELD_LABELS map the employer page uses, so a copy edit
        // to one string can no longer silently drop a row from the consent
        // list while the employer still receives the value.
        fields: row.packet?.includedFields ?? [],
        endorsement: row.packet?.endorsement ?? "",
        candidateName: row.packet?.candidateName ?? "",
        certifications: row.packet?.certifications ?? [],
        availabilitySummary: row.packet?.availabilitySummary ?? "",
        earliestStart: row.packet?.earliestStart ?? null,
        subsidyLine: row.packet?.subsidyLine ?? null,
        // Null when tailoring failed or timed out. The card says so rather
        // than letting a student consent to a résumé that is not there.
        hasResume: Boolean(row.packet?.resumeVersionId),
      })),
      // Already approved: sent, opened, answered, booked. Each carries a plain
      // status phrase and can be taken back.
      active: active.map((row) => ({
        id: row.id,
        jobTitle: row.jobTitle,
        employerName: row.employerName,
        status: row.status,
        statusPhrase: connectionStatusPhrase(row.status, row.employerName),
        sentOn: row.sentAt ? row.sentAt.slice(0, 10) : null,
      })),
    },
  });
});
