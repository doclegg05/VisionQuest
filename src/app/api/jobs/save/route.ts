import { NextResponse } from "next/server";
import { withAuth, badRequest, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { checkLength } from "@/lib/validation";

const VALID_STATUSES = ["saved", "applied", "interviewing", "offered", "withdrawn"];
const APPLIED_STATUSES = new Set(["applied", "interviewing", "offered"]);

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

  const cleanNotes = typeof notes === "string" ? notes.trim() : notes;
  if (typeof cleanNotes === "string") {
    const notesError = checkLength(cleanNotes, "notes", "Job notes");
    if (notesError) throw badRequest(notesError);
  }

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
