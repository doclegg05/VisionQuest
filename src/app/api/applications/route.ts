import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { afterWrite } from "@/lib/after-write";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";
import { OUTCOME_VERIFICATION } from "@/lib/outcome-verification";
import { logger } from "@/lib/logger";
import { deleteFile } from "@/lib/storage";
import { NO_PATHWAY_PROVENANCE, resolvePathwayProvenance } from "@/lib/pathway-provenance";
import { parseBody, opportunityApplicationSchema } from "@/lib/schemas";
import { studentLogKey } from "@/lib/log-keys";

const APPLIED_STATUSES = new Set(["applied", "interviewing", "offer"]);

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
      student: studentLogKey(studentId),
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
      select: { id: true, resumeFileId: true, appliedAt: true },
    }),
  ]);
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }
  if (resumeFileId && !file) {
    return NextResponse.json({ error: "Resume file not found." }, { status: 400 });
  }

  const shouldSetAppliedAt = APPLIED_STATUSES.has(status) && !existingApplication?.appliedAt;
  const appliedAt = shouldSetAppliedAt ? new Date() : undefined;

  // Pathway provenance is a creation-time snapshot, so it is read only when
  // there is no row yet — and it appears only in the upsert's `create`
  // branch below. An existing application keeps the pathway it was filed
  // under, whatever the student's discovery says today.
  const pathwayProvenance = existingApplication
    ? NO_PATHWAY_PROVENANCE
    : await resolvePathwayProvenance(prisma, session.id);

  const application = await prisma.application.upsert({
    where: {
      studentId_opportunityId: {
        studentId: session.id,
        opportunityId,
      },
    },
    // P1-4: every status change through this route is a student claim. Stamp
    // it self-reported (clearing any prior instructor verification, which the
    // new claim supersedes) so grant reports can split verified vs
    // self-reported outcomes.
    update: {
      status,
      notes: notes || null,
      resumeFileId: resumeFileId || null,
      appliedAt,
      verificationStatus: OUTCOME_VERIFICATION.SELF_REPORTED,
      verifiedBy: null,
      verifiedAt: null,
    },
    create: {
      studentId: session.id,
      opportunityId,
      status,
      notes: notes || null,
      resumeFileId: resumeFileId || null,
      appliedAt: APPLIED_STATUSES.has(status) ? (appliedAt ?? new Date()) : null,
      verificationStatus: OUTCOME_VERIFICATION.SELF_REPORTED,
      pathwayClusterId: pathwayProvenance.pathwayClusterId,
      pathwaySnapshotAt: pathwayProvenance.pathwaySnapshotAt,
    },
  });

  // The application is saved. Everything below is best-effort: a failure is
  // logged, never reported to the student as a failed application.
  await afterWrite(
    () =>
      cleanupDetachedGeneratedResumeFile(
        session.id,
        existingApplication?.resumeFileId,
        resumeFileId || null,
        application.id,
      ),
    { surface: "applications", effect: "cleanupDetachedGeneratedResumeFile", studentId: session.id },
  );

  await afterWrite(
    () =>
      logAuditEvent({
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
      }),
    { surface: "applications", effect: "logAuditEvent", studentId: session.id, level: "error" },
  );

  await afterWrite(() => syncStudentAlerts(session.id), {
    surface: "applications",
    effect: "syncStudentAlerts",
    studentId: session.id,
  });

  return NextResponse.json({ application });
});
