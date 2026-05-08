import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { MAX_LENGTHS } from "@/lib/validation";
import { parseBody } from "@/lib/schemas";

const VALID_STATUSES = ["saved", "applied", "interviewing", "offered", "withdrawn"] as const;

const saveJobSchema = z.object({
  jobListingId: z.string().cuid("Invalid job listing ID."),
  status: z.enum(VALID_STATUSES).optional(),
  notes: z.string().max(MAX_LENGTHS.notes).optional(),
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

  // Verify job exists
  const job = await prisma.jobListing.findUnique({
    where: { id: jobListingId },
    select: { id: true, title: true },
  });
  if (!job) {
    throw badRequest("Job listing not found");
  }

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
      notes: notes ?? null,
    },
    update: {
      status: saveStatus,
      notes: notes !== undefined ? notes : undefined,
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
