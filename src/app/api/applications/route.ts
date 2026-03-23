import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { deleteFile } from "@/lib/storage";

const VALID_APPLICATION_STATUSES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "withdrawn",
] as const;

async function cleanupDetachedGeneratedResumeFile(
  studentId: string,
  previousResumeFileId: string | null | undefined,
  nextResumeFileId: string | null,
  currentApplicationId: string,
) {
  if (!previousResumeFileId || previousResumeFileId === nextResumeFileId) {
    return;
  }

  const generatedFile = await prisma.fileUpload.findFirst({
    where: {
      id: previousResumeFileId,
      studentId,
      category: "resume-generated",
    },
    select: {
      id: true,
      storageKey: true,
    },
  });
  if (!generatedFile) {
    return;
  }

  const otherReferences = await prisma.application.count({
    where: {
      resumeFileId: previousResumeFileId,
      NOT: { id: currentApplicationId },
    },
  });
  if (otherReferences > 0) {
    return;
  }

  try {
    await deleteFile(generatedFile.storageKey);
  } catch (error) {
    logger.warn("Failed to delete detached generated resume from storage", {
      studentId,
      fileId: generatedFile.id,
      storageKey: generatedFile.storageKey,
      error: String(error),
    });
  }

  await prisma.fileUpload.deleteMany({
    where: {
      id: generatedFile.id,
      studentId,
      category: "resume-generated",
    },
  });
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json();
  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : "";
  const status = typeof body.status === "string" ? body.status.trim() : "saved";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const resumeFileId = typeof body.resumeFileId === "string" ? body.resumeFileId : "";

  if (!opportunityId) {
    return NextResponse.json({ error: "Opportunity is required." }, { status: 400 });
  }
  if (!VALID_APPLICATION_STATUSES.includes(status as (typeof VALID_APPLICATION_STATUSES)[number])) {
    return NextResponse.json({ error: "Application status is invalid." }, { status: 400 });
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, title: true },
  });
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }

  if (resumeFileId) {
    const file = await prisma.fileUpload.findFirst({
      where: {
        id: resumeFileId,
        studentId: session.id,
      },
      select: { id: true },
    });
    if (!file) {
      return NextResponse.json({ error: "Resume file not found." }, { status: 400 });
    }
  }

  const existingApplication = await prisma.application.findUnique({
    where: {
      studentId_opportunityId: {
        studentId: session.id,
        opportunityId,
      },
    },
    select: {
      id: true,
      resumeFileId: true,
    },
  });

  const application = await prisma.application.upsert({
    where: {
      studentId_opportunityId: {
        studentId: session.id,
        opportunityId,
      },
    },
    update: {
      status,
      notes: notes || null,
      resumeFileId: resumeFileId || null,
      appliedAt: status === "applied" ? new Date() : undefined,
    },
    create: {
      studentId: session.id,
      opportunityId,
      status,
      notes: notes || null,
      resumeFileId: resumeFileId || null,
      appliedAt: status === "applied" ? new Date() : null,
    },
  });

  await cleanupDetachedGeneratedResumeFile(
    session.id,
    existingApplication?.resumeFileId,
    resumeFileId || null,
    application.id,
  );

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "application.updated",
    targetType: "opportunity",
    targetId: opportunityId,
    summary: `Set application for "${opportunity.title}" to ${status}.`,
    metadata: {
      applicationId: application.id,
      status,
    },
  });

  await syncStudentAlerts(session.id);

  return NextResponse.json({ application });
});
