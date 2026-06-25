/**
 * Certification self-report actions for Sage tools.
 *
 * Mirrors the logic in /api/certifications (GET ensure + POST self-report) so
 * `lookup_cert_progress` and `mark_certification_complete` behave identically
 * to the Certifications page: same auto-create, same validation, same
 * idempotent XP award on completion. Kept in one module so the two tools can't
 * drift from each other or from the route.
 */

import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { validateRequirementUpdate } from "@/lib/certifications";
import { recomputeCertificationStatus } from "@/lib/certification-service";
import { recordCertificationStarted, recordCertificationEarned } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";

const CERT_TYPE = "ready-to-work";

export interface CertRequirementView {
  requirementId: string;
  label: string;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  completed: boolean;
  hasFile: boolean;
  /** Completed by the student but still pending instructor verification. */
  awaitingVerification: boolean;
}

export interface CertProgress {
  certificationId: string;
  status: string;
  requirements: CertRequirementView[];
  done: number;
  total: number;
}

/**
 * Ensure the student has a Ready-to-Work certification (auto-creating it from
 * templates the first time, exactly like the GET route) and return its
 * requirements with the ids needed to mark them complete.
 */
export async function ensureStudentCertification(studentId: string): Promise<CertProgress | null> {
  const templates = await prisma.certTemplate.findMany({
    where: { certType: CERT_TYPE },
    orderBy: { sortOrder: "asc" },
  });
  if (templates.length === 0) return null;

  let cert = await prisma.certification.findUnique({
    where: { studentId_certType: { studentId, certType: CERT_TYPE } },
    include: { requirements: true },
  });

  if (!cert) {
    cert = await prisma.certification.create({
      data: {
        studentId,
        certType: CERT_TYPE,
        requirements: { create: templates.map((t) => ({ templateId: t.id })) },
      },
      include: { requirements: true },
    });
    try {
      await awardEvent({
        studentId,
        eventType: "cert_started",
        sourceType: "certification",
        sourceId: cert.id,
        xp: 25,
        mutate: (state) => recordCertificationStarted(state),
      });
    } catch (err) {
      logger.error("ensureStudentCertification: cert_started award failed", { error: String(err) });
    }
  }

  cert = await recomputeCertificationStatus(cert.id, cert.certType);

  const requirements: CertRequirementView[] = templates.map((t) => {
    const req = cert!.requirements.find((r) => r.templateId === t.id);
    const completed = req?.completed ?? false;
    return {
      requirementId: req?.id ?? "",
      label: t.label,
      required: t.required,
      needsFile: t.needsFile,
      needsVerify: t.needsVerify,
      completed,
      hasFile: Boolean(req?.fileId),
      awaitingVerification: completed && t.needsVerify && !req?.verifiedBy,
    };
  });

  const total = requirements.filter((r) => r.required).length;
  const done = requirements.filter((r) => r.required && r.completed).length;

  return { certificationId: cert.id, status: cert.status, requirements, done, total };
}

export type MarkRequirementResult =
  | { ok: false; reason: string }
  | { ok: true; label: string; certCompleted: boolean; awaitingVerification: boolean };

/**
 * Self-report a single certification requirement as complete. Replicates the
 * POST /api/certifications path: validation, update, status recompute, and the
 * idempotent cert_earned award when the whole certification just completed.
 */
export async function markRequirementComplete(params: {
  studentId: string;
  requirementId: string;
  fileId?: string | null;
}): Promise<MarkRequirementResult> {
  const { studentId, requirementId } = params;

  const requirement = await prisma.certRequirement.findFirst({
    where: { id: requirementId },
    include: {
      certification: { select: { studentId: true } },
      template: {
        select: { id: true, certType: true, required: true, needsFile: true, needsVerify: true, label: true },
      },
    },
  });
  if (!requirement || requirement.certification.studentId !== studentId) {
    return { ok: false, reason: "That certification item wasn't found on your account." };
  }

  const fileId = params.fileId !== undefined ? params.fileId : requirement.fileId;
  if (fileId) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId },
      select: { id: true },
    });
    if (!file) return { ok: false, reason: "That attached file wasn't found on your account." };
  }

  const validationError = validateRequirementUpdate(requirement.template, {
    templateId: requirement.templateId,
    completed: true,
    verifiedBy: requirement.verifiedBy ?? null,
    fileId: fileId ?? null,
  });
  if (validationError) return { ok: false, reason: validationError };

  await prisma.certRequirement.update({
    where: { id: requirementId },
    data: {
      completed: true,
      completedAt: new Date(),
      ...(params.fileId !== undefined ? { fileId: params.fileId || null } : {}),
    },
  });

  const updatedCert = await recomputeCertificationStatus(
    requirement.certificationId,
    requirement.template.certType,
  );

  if (updatedCert.status === "completed") {
    await awardEvent({
      studentId,
      eventType: "cert_earned",
      sourceType: "certification",
      sourceId: requirement.certificationId,
      xp: 100,
      mutate: (state) => recordCertificationEarned(state),
    });
  }

  await syncStudentAlerts(studentId);

  return {
    ok: true,
    label: requirement.template.label,
    certCompleted: updatedCert.status === "completed",
    awaitingVerification: requirement.template.needsVerify && !requirement.verifiedBy,
  };
}
