import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { deleteFile } from "@/lib/storage";
import { parseBody, opportunityApplicationSchema } from "@/lib/schemas";

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
  const { opportunityId, status, notes, resumeFileId } = await parseBody(
    req,
    opportunityApplicationSchema,
  );

  // opportunity, resume-file ownership, and existing-application lookups
  // are independent — run together.
  const [opportunity, file, existingApplication] = await Promise.all([
    prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true, title: true },
    }),
    resumeFileId
      ? prisma.fileUpload.findFirst({
          where: { id: resumeFileId, studentId: session.id },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.application.findUnique({
      where: {
        studentId_opportunityId: {
          studentId: session.id,
          opportunityId,
        },
      },
      select: { id: true, resumeFileId: true },
    }),
  ]);
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }
  if (resumeFileId && !file) {
    return NextResponse.json({ error: "Resume file not found." }, { status: 400 });
  }

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
