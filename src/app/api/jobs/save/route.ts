import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { MAX_LENGTHS } from "@/lib/validation";
import { parseBody } from "@/lib/schemas";
import { trackJobInterest, type JobInterestSource } from "@/lib/job-applications";

const VALID_STATUSES = ["saved", "applied", "interviewing", "offered", "withdrawn"] as const;

const saveJobSchema = z
  .object({
    jobListingId: z.string().cuid("Invalid job listing ID.").optional(),
    browseListingId: z.string().cuid("Invalid browse listing ID.").optional(),
    status: z.enum(VALID_STATUSES).optional(),
    notes: z.string().trim().max(MAX_LENGTHS.notes, "Job notes must be 10000 characters or fewer.").optional(),
  })
  .refine(
    (body) => (body.jobListingId ? 1 : 0) + (body.browseListingId ? 1 : 0) === 1,
    { message: "Provide exactly one of jobListingId or browseListingId." },
  );

/**
 * POST /api/jobs/save
 *
 * Track a student's interest in a job through the unified Application
 * pipeline (VQ-R-017): the listing resolves to a url-deduped Opportunity and
 * the student's Application row is upserted against it. Accepts either a
 * class-board listing (jobListingId, class-scope checked) or a program-wide
 * browse listing (browseListingId).
 *
 * Body: { jobListingId?: string, browseListingId?: string, status?: string, notes?: string }
 */
export const POST = withAuth(async (session: Session, req: Request) => {
  const { jobListingId, browseListingId, status, notes } = await parseBody(req, saveJobSchema);
  const saveStatus = status ?? "saved";

  let source: JobInterestSource;
  if (jobListingId) {
    // Enrollment is required only to validate a class-scoped listing
    // (VQ-R-016): the class board is the only thing enrollment gates.
    const enrollment = await prisma.studentClassEnrollment.findFirst({
      where: { studentId: session.id, status: "active" },
      select: { classId: true },
    });
    if (!enrollment) {
      throw badRequest("No active class enrollment found");
    }
    // Verify the class listing belongs to the student's active class before
    // tracking it — a student must not track another cohort's board rows.
    const job = await prisma.jobListing.findFirst({
      where: {
        id: jobListingId,
        classConfig: { classId: enrollment.classId },
      },
      select: { id: true },
    });
    if (!job) {
      throw badRequest("Job listing not found");
    }
    source = { kind: "listing", jobListingId };
  } else {
    // Browse rows are program-wide: any student may track one, enrolled or
    // not. browseListingId is guaranteed by the schema refine; existence is
    // verified by trackJobInterest when it resolves the row.
    source = { kind: "browse", browseListingId: browseListingId! };
  }

  const result = await trackJobInterest({
    studentId: session.id,
    source,
    status: saveStatus,
    notes,
  });
  if (!result.ok) {
    throw badRequest("Job listing not found");
  }

  await logAuditEvent({
    action: "job.save",
    actorId: session.id,
    targetType: jobListingId ? "JobListing" : "JobBrowseListing",
    targetId: jobListingId ?? browseListingId ?? null,
    summary: `${session.displayName} ${saveStatus} job "${result.opportunity.title}"`,
  });

  return NextResponse.json({ application: result.application });
});
