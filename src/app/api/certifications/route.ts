import { NextResponse } from "next/server";
import { z } from "zod";
import { syncStudentAlerts } from "@/lib/advising";
import { prisma } from "@/lib/db";
import { getCertificationProgress, validateRequirementUpdate } from "@/lib/certifications";
import { recomputeCertificationStatus } from "@/lib/certification-service";
import { withAuth, badRequest, notFound } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { recordCertificationStarted, recordCertificationEarned } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";

const certUpdateSchema = z.object({
  requirementId: z.string().cuid(),
  completed: z.boolean().optional(),
  fileId: z.string().cuid().optional().nullable(),
  notes: z.string().max(2000).optional(),
});

// GET — get student's certification with requirements
export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const shouldEnsureCertification = searchParams.get("ensure") !== "false";

  // Get all templates
  const templates = await prisma.certTemplate.findMany({
    where: { certType: "ready-to-work" },
    orderBy: { sortOrder: "asc" },
  });

  // Get or create certification record
  let cert = await prisma.certification.findUnique({
    where: { studentId_certType: { studentId: session.id, certType: "ready-to-work" } },
    include: { requirements: true },
  });

  if (!cert && templates.length > 0 && shouldEnsureCertification) {
    // Auto-create certification and requirement records from templates
    cert = await prisma.certification.create({
      data: {
        studentId: session.id,
        certType: "ready-to-work",
        requirements: {
          create: templates.map((t) => ({
            templateId: t.id,
          })),
        },
      },
      include: { requirements: true },
    });

    // Record certification started for progression
    try {
      await awardEvent({
        studentId: session.id,
        eventType: "cert_started",
        sourceType: "certification",
        sourceId: cert.id,
        xp: 25,
        mutate: (state) => recordCertificationStarted(state),
      });
    } catch (err) {
      logger.error("Failed to record certification started", { error: String(err) });
    }
  }

  if (!cert) {
    const requirements = templates.map((t) => ({
      id: null,
      templateId: t.id,
      label: t.label,
      description: t.description,
      url: t.url,
      required: t.required,
      needsFile: t.needsFile,
      needsVerify: t.needsVerify,
      completed: false,
      completedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      fileId: null,
      notes: null,
    }));
    const { total, done } = getCertificationProgress(templates, requirements);

    return NextResponse.json({
      certification: null,
      templates,
      requirements,
      total,
      done,
      studentName: session.displayName,
    });
  }

  cert = await recomputeCertificationStatus(cert.id, cert.certType);

  // Merge template info with requirement progress
  const requirements = templates.map((t) => {
    const req = cert!.requirements.find((r) => r.templateId === t.id);
    return {
      id: req?.id || null,
      templateId: t.id,
      label: t.label,
      description: t.description,
      url: t.url,
      required: t.required,
      needsFile: t.needsFile,
      needsVerify: t.needsVerify,
      completed: req?.completed || false,
      completedAt: req?.completedAt || null,
      verifiedBy: req?.verifiedBy || null,
      verifiedAt: req?.verifiedAt || null,
      fileId: req?.fileId || null,
      notes: req?.notes || null,
    };
  });

  const { total, done } = getCertificationProgress(templates, requirements);

  return NextResponse.json({
    certification: {
      id: cert.id,
      status: cert.status,
      startedAt: cert.startedAt,
      completedAt: cert.completedAt,
    },
    requirements,
    total,
    done,
    studentName: session.displayName,
  });
});

// POST — mark a requirement as completed (self-report)
export const POST = withAuth(async (session, req: Request) => {
  const { requirementId, completed, fileId, notes } = await parseBody(req, certUpdateSchema);

  // Verify the requirement belongs to this student's certification
  const requirement = await prisma.certRequirement.findFirst({
    where: { id: requirementId },
    include: {
      certification: true,
      template: {
        select: {
          id: true,
          certType: true,
          required: true,
          needsFile: true,
          needsVerify: true,
        },
      },
    },
  });

  if (!requirement || requirement.certification.studentId !== session.id) {
    throw notFound("Requirement not found");
  }

  if (fileId !== undefined && fileId !== null) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
      select: { id: true },
    });

    if (!file) throw notFound("Attached file was not found");
  }

  const nextState = {
    templateId: requirement.templateId,
    completed: typeof completed === "boolean" ? completed : requirement.completed,
    verifiedBy: typeof completed === "boolean" && !completed ? null : requirement.verifiedBy,
    fileId: fileId !== undefined ? (fileId || null) : requirement.fileId,
  };
  if (typeof completed === "boolean" || fileId !== undefined) {
    const validationError = validateRequirementUpdate(requirement.template, nextState);

    if (validationError) throw badRequest(validationError);
  }

  const data: Record<string, unknown> = {};
  if (typeof completed === "boolean") {
    data.completed = completed;
    data.completedAt = completed ? new Date() : null;
    if (!completed) {
      data.verifiedBy = null;
      data.verifiedAt = null;
    }
  }
  if (fileId !== undefined) data.fileId = fileId || null;
  if (notes !== undefined) data.notes = notes;

  await prisma.certRequirement.update({
    where: { id: requirementId },
    data,
  });

  // Check if all required requirements are truly satisfied.
  const updatedCert = await recomputeCertificationStatus(requirement.certificationId, requirement.template.certType);

  // Record certification earned if just completed
  if (updatedCert.status === "completed") {
    try {
      await awardEvent({
        studentId: session.id,
        eventType: "cert_earned",
        sourceType: "certification",
        sourceId: requirement.certificationId,
        xp: 100,
        mutate: (state) => recordCertificationEarned(state),
      });
    } catch (err) {
      // The cert is already marked completed above. Swallowing an award
      // failure here leaves a "phantom" cert — completed with no XP —
      // which corrupts grant counts. awardEvent is idempotent (events.ts),
      // so surfacing the error lets the request retry and reconcile rather
      // than silently diverging. (Full atomicity would wrap update+recompute
      // +award in a single $transaction; tracked as a follow-up.)
      logger.error("Failed to record certification earned", { error: String(err) });
      throw err;
    }
  }

  await syncStudentAlerts(session.id);

  return NextResponse.json({ ok: true });
});
