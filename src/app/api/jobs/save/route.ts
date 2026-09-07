import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, ApiError, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { MAX_LENGTHS } from "@/lib/validation";
import { parseBody } from "@/lib/schemas";

const VALID_STATUSES = ["saved", "applied", "interviewing", "offered", "withdrawn"] as const;
const APPLIED_STATUSES = new Set(["applied", "interviewing", "offered"]);

const saveJobSchema = z.object({
  jobListingId: z.string().cuid("Invalid job listing ID."),
  status: z.enum(VALID_STATUSES).optional(),
  notes: z.string().trim().max(MAX_LENGTHS.notes, "Job notes must be 10000 characters or fewer.").optional(),
});

/**
 * VQ-R-016: a bare 400 here used to be indistinguishable from "that id
 * doesn't exist anywhere" — the client (`CareerHub.handleSaveJob`) ignored
 * `!res.ok` entirely, so an enrolled student saving a `JobBrowseListing` row
 * (or an unenrolled/browse-mode student saving one at all) saw the Save
 * button silently do nothing. `StudentSavedJob.jobListingId` has an FK to
 * `JobListing` only, so a browse-pool row can't be tracked there yet
 * (memo §3 leaves the two-tracker question open) — this returns a distinct,
 * client-legible code instead so the UI can say something specific.
 */
function notYourClassBoard() {
  return new ApiError(
    400,
    "This job isn't on your class's board yet. Try a different job below, or ask your teacher.",
    "not_your_class_board",
  );
}

async function isBrowsePoolJob(id: string): Promise<boolean> {
  const row = await prisma.jobBrowseListing.findUnique({
    where: { id },
    select: { id: true },
  });
  return row !== null;
}

/**
 * POST /api/jobs/save
 *
 * Save or update a student's interaction with a job listing.
 * Body: { jobListingId: string, status?: string, notes?: string }
 */
export const POST = withAuth(async (session: Session, req: Request) => {
  const { jobListingId, status, notes } = await parseBody(req, saveJobSchema);
  const saveStatus = status ?? "saved";
  const cleanNotes = notes;

  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId: session.id, status: "active" },
    select: { classId: true },
  });
  if (!enrollment) {
    // No class board to save against — the GET route serves these students
    // the program-wide browse pool, so a jobListingId here is almost always
    // a JobBrowseListing id.
    if (await isBrowsePoolJob(jobListingId)) {
      throw notYourClassBoard();
    }
    throw badRequest("No active class enrollment found");
  }

  // Verify the job belongs to the student's active class before tracking it.
  const job = await prisma.jobListing.findFirst({
    where: {
      id: jobListingId,
      classConfig: { classId: enrollment.classId },
    },
    select: { id: true, title: true },
  });
  if (!job) {
    if (await isBrowsePoolJob(jobListingId)) {
      throw notYourClassBoard();
    }
    throw badRequest("Job listing not found");
  }

  const existingSavedJob = await prisma.studentSavedJob.findUnique({
    where: {
      studentId_jobListingId: {
        studentId: session.id,
        jobListingId,
      },
    },
    select: { appliedAt: true },
  });
  const shouldSetAppliedAt = APPLIED_STATUSES.has(saveStatus) && !existingSavedJob?.appliedAt;
  const appliedAt = shouldSetAppliedAt ? new Date() : undefined;

  const savedJob = await prisma.studentSavedJob.upsert({
    where: {
      studentId_jobListingId: {
        studentId: session.id,
        jobListingId,
      },
    },
    create: {
      studentId: session.id,
      jobListingId,
      status: saveStatus,
      notes: cleanNotes || null,
      appliedAt: APPLIED_STATUSES.has(saveStatus) ? (appliedAt ?? new Date()) : null,
    },
    update: {
      status: saveStatus,
      notes: notes !== undefined ? cleanNotes || null : undefined,
      appliedAt,
    },
  });

  await logAuditEvent({
    action: "job.save",
    actorId: session.id,
    targetType: "JobListing",
    targetId: jobListingId,
    summary: `${session.displayName} ${saveStatus} job "${job.title}"`,
  });

  return NextResponse.json({ savedJob });
});
