import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import {
  createLead,
  createLeadSchema,
  listLeads,
  updateLead,
  updateLeadSchema,
} from "@/lib/connect/leads";
import { JOB_LEAD_STATUSES } from "@/lib/connect/leads-shared";
import { summarizeLeadFits } from "@/lib/connect/matching";
import { parseBody } from "@/lib/schemas";

/**
 * The leads board (Match & Connect Task 3.2).
 *
 * GET returns each lead with its employer and, when `?fitCounts=1`, the
 * "N fit / M blocked" pair the console's board shows. The counts come from
 * `summarizeLeadFits`, which loads the roster ONCE for the whole page — asking
 * per lead would be four queries a row.
 *
 * The counts are aggregate numbers, not student records: no name, no id, no
 * per-student detail crosses this boundary. The reverse-match view that DOES
 * name students is the console page itself, which calls `recordStudentView`
 * for everyone it shows.
 *
 * POST covers both the hand-typed lead and the MACC job order — the same body
 * with `source: "joborder"`. A lead copied from a scraped posting goes through
 * ./from-listing instead, because that path sets `sourceRef` itself.
 */

const listQuerySchema = z.object({
  status: z.enum(JOB_LEAD_STATUSES).optional(),
  employerId: z.string().cuid().optional(),
  fitCounts: z.enum(["0", "1"]).optional(),
});

export const GET = withTeacherAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    employerId: url.searchParams.get("employerId") ?? undefined,
    fitCounts: url.searchParams.get("fitCounts") ?? undefined,
  });
  // Same reasoning as the employer list: a malformed filter used to fall back
  // to {} and return every lead, including the closed ones.
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid filter.");
  }
  const query = parsed.data;

  const leads = await listLeads({ status: query.status, employerId: query.employerId });

  if (query.fitCounts !== "1") {
    return NextResponse.json({ leads });
  }

  // Only open leads are worth counting: a filled or closed lead hard-blocks
  // everyone, so its counts would read "0 fit / 30 blocked" and mean nothing.
  const openLeadIds = leads.filter((lead) => lead.status === "open").map((lead) => lead.id);
  const counts = await summarizeLeadFits(openLeadIds);
  const byLead = new Map(counts.map((entry) => [entry.jobLeadId, entry]));

  // Counts only. summarizeLeadFits also carries the blocked students' NAMES
  // for the console's drill-in, and that is deliberately dropped here: this
  // route is a filterable list endpoint, and a roster of who does not qualify
  // for a job is not something it should hand out.
  return NextResponse.json({
    leads: leads.map((lead) => ({
      ...lead,
      fitCount: byLead.get(lead.id)?.fitCount ?? null,
      blockedCount: byLead.get(lead.id)?.blockedCount ?? null,
    })),
  });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, createLeadSchema);

  let lead;
  try {
    lead = await createLead(input, session);
  } catch (error: unknown) {
    // createLead raises its own 404s for a class the caller does not manage
    // and for a contact at another employer; those messages are the useful
    // ones. Anything else is a Prisma error naming the constraint, the table
    // and the schema, so it is translated rather than forwarded.
    if (error instanceof ApiError) throw error;
    throw notFound("That employer, contact or class wasn't found.");
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.job_lead.created",
    targetType: "job_lead",
    targetId: lead.id,
    summary: `Added lead "${lead.title}" at ${lead.employer.name}.`,
    metadata: { employerId: lead.employerId, source: lead.source, classId: lead.classId },
  });

  return NextResponse.json({ lead });
});

export const PUT = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, updateLeadSchema);

  let lead;
  try {
    lead = await updateLead(input, session);
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    throw notFound("That lead wasn't found.");
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.job_lead.updated",
    targetType: "job_lead",
    targetId: lead.id,
    summary: `Updated lead "${lead.title}" at ${lead.employer.name}.`,
    metadata: { status: lead.status },
  });

  return NextResponse.json({ lead });
});
