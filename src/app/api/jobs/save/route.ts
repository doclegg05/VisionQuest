import { NextResponse } from "next/server";
import { withAuth, badRequest, forbidden, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const VALID_STATUSES = ["saved", "applied", "interviewing", "offered", "withdrawn"];

/**
 * POST /api/jobs/save
 *
 * Save or update a student's interaction with a job listing.
 * Body: { jobListingId: string, status?: string, notes?: string }
 */
export const POST = withAuth(async (session: Session, req: Request) => {
  const body = await req.json();
  const { jobListingId, status, notes } = body as {
    jobListingId?: string;
    status?: string;
    notes?: string;
  };

  if (!jobListingId || typeof jobListingId !== "string") {
    throw badRequest("jobListingId is required");
  }

  const saveStatus = status ?? "saved";
  if (!VALID_STATUSES.includes(saveStatus)) {
    throw badRequest(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId: session.id, status: "active" },
    select: { classId: true },
  });

  if (!enrollment) {
    throw forbidden("You do not have access to this job listing.");
  }

  // Verify job exists and belongs to the student's active class
  const job = await prisma.jobListing.findFirst({
    where: {
      id: jobListingId,
      classConfig: {
        classId: enrollment.classId,
      },
    },
    select: { id: true, title: true },
  });
  if (!job) {
    throw forbidden("You do not have access to this job listing.");
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
