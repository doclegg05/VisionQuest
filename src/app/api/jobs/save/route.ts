import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, type Session } from "@/lib/api-error";
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
