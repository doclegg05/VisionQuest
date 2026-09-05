import { NextResponse } from "next/server";

import { notFound, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import {
  JobListingNotFoundError,
  createLeadFromListing,
  leadFromListingSchema,
} from "@/lib/connect/leads";
import { parseBody } from "@/lib/schemas";

/**
 * "Make this a lead" — one scraped `JobListing` becomes an employer-linked
 * `JobLead` (Match & Connect Task 3.2).
 *
 * Idempotent: the listing's id is stored as `sourceRef`, so converting the
 * same posting twice returns the first lead with `created: false` instead of
 * a duplicate. The employer is found-or-created by name through the unique
 * `nameKey`, so two instructors clicking at once still end up with one
 * employer row.
 *
 * `source` and `sourceRef` are set by the server. They are provenance, and a
 * client that could choose them could make a hand-typed lead claim it came
 * from a real posting.
 */

export const POST = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, leadFromListingSchema);

  let result;
  try {
    result = await createLeadFromListing(input, session.id);
  } catch (error: unknown) {
    if (error instanceof JobListingNotFoundError) {
      throw notFound(error.message);
    }
    throw notFound("That job posting or class wasn't found.");
  }

  if (result.created) {
    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "connect.job_lead.created",
      targetType: "job_lead",
      targetId: result.lead.id,
      summary: `Made a lead from a job posting: "${result.lead.title}" at ${result.lead.employer.name}.`,
      metadata: {
        employerId: result.lead.employerId,
        source: "joblisting",
        sourceRef: input.jobListingId,
      },
    });
  }

  return NextResponse.json({ lead: result.lead, created: result.created });
});
