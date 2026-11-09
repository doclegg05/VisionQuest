import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, forbidden, type Session } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { MAX_LENGTHS } from "@/lib/validation";
import { parseBody } from "@/lib/schemas";
import { resolveListingForStudent, saveJobForStudent } from "@/lib/job-board/job-preferences";

const VALID_STATUSES = ["saved", "applied", "interviewing", "offered", "withdrawn"] as const;

const saveJobSchema = z.object({
  // A class-board JobListing id or a browse-pool JobBrowseListing id.
  jobListingId: z.string().cuid("Invalid job listing ID."),
  status: z.enum(VALID_STATUSES).optional(),
  notes: z.string().trim().max(MAX_LENGTHS.notes, "Job notes must be 10000 characters or fewer.").optional(),
});

/** Only students keep a job tracker. Staff would write onto their own row. */
function requireStudent(session: Session): void {
  if (session.role !== "student") {
    throw forbidden("Only students can save jobs.");
  }
}

/**
 * POST /api/jobs/save
 *
 * Save or update a student's tracker row for a job.
 * Body: { jobListingId: string, status?: string, notes?: string }
 *
 * W4 (2026-11-09): accepts browse-pool jobs too, checks class jobs against
 * every active class (not only the first), and keys the row to the vacancy
 * (source + source id) with a snapshot, so it survives the listing's
 * deletion, a reimport and a class transfer. Queries live in
 * src/lib/job-board/job-preferences.ts.
 */
export const POST = withAuth(async (session: Session, req: Request) => {
  requireStudent(session);
  const { jobListingId, status, notes } = await parseBody(req, saveJobSchema);
  const saveStatus = status ?? "saved";

  const listing = await resolveListingForStudent(session.id, jobListingId);
  if (!listing) {
    throw badRequest("Job listing not found");
  }

  const savedJob = await saveJobForStudent(session.id, listing, { status: saveStatus, notes });

  await logAuditEvent({
    action: "job.save",
    actorId: session.id,
    targetType: listing.kind === "class" ? "JobListing" : "JobBrowseListing",
    targetId: listing.id,
    summary: `${session.displayName} ${saveStatus} job "${listing.title}"`,
  });

  return NextResponse.json({ savedJob });
});
