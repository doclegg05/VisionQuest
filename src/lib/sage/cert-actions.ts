/**
 * Certification self-report actions for Sage tools.
 *
 * Mirrors the logic in /api/certifications so `lookup_cert_progress` and
 * `mark_certification_complete` behave like the Certifications page: same
 * validation, same idempotent XP award on completion. Kept in one module so
 * the two tools can't drift from each other or from the route.
 *
 * The lookup is read-only. The Certification row (and its cert_started XP)
 * is created by GET /api/certifications when the student opens the
 * Certifications page — never by a read-tier agent tool (SAGE-03 / VQ-R-009).
 */

import { prisma } from "@/lib/db";
import { OUTCOME_VERIFICATION } from "@/lib/outcome-verification";
import { syncStudentAlerts } from "@/lib/advising";
import { validateRequirementUpdate } from "@/lib/certifications";
import { recomputeCertificationStatus } from "@/lib/certification-service";
import { recordCertificationEarned } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";

const CERT_TYPE = "ready-to-work";

/** A checklist item as its template defines it — what the student will need to do. */
export interface CertTemplateView {
  label: string;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
}

/** A checklist item on the student's own certification, with the id needed to mark it. */
export interface CertRequirementView extends CertTemplateView {
  requirementId: string;
  completed: boolean;
  hasFile: boolean;
  /** Completed by the student but still pending instructor verification. */
  awaitingVerification: boolean;
}

export type CertProgress =
  /** No Certification row yet: the checklist exists only as templates. */
  | { started: false; total: number; requirements: CertTemplateView[] }
  | {
      started: true;
      certificationId: string;
      status: string;
      requirements: CertRequirementView[];
      done: number;
      total: number;
    };

/**
 * The student's Ready-to-Work progress, read-only. Returns null when no
 * templates are seeded, a not-started view when the student has no
 * Certification row, and otherwise the row's requirements with the ids
 * `mark_certification_complete` needs.
 */
export async function lookupCertProgress(studentId: string): Promise<CertProgress | null> {
  const templates = await prisma.certTemplate.findMany({
    where: { certType: CERT_TYPE },
    orderBy: { sortOrder: "asc" },
  });
  if (templates.length === 0) return null;

  const total = templates.filter((t) => t.required).length;

  const existing = await prisma.certification.findUnique({
    where: { studentId_certType: { studentId, certType: CERT_TYPE } },
    select: { id: true, certType: true },
  });
  if (!existing) {
    return { started: false, total, requirements: templates.map(toTemplateView) };
  }

  const cert = await recomputeCertificationStatus(existing.id, existing.certType);

  const requirements: CertRequirementView[] = templates.map((t) => {
    const req = cert.requirements.find((r) => r.templateId === t.id);
    const completed = req?.completed ?? false;
    return {
      ...toTemplateView(t),
      requirementId: req?.id ?? "",
      completed,
      hasFile: Boolean(req?.fileId),
      awaitingVerification: completed && t.needsVerify && !req?.verifiedBy,
    };
  });
  const done = requirements.filter((r) => r.required && r.completed).length;

  return { started: true, certificationId: cert.id, status: cert.status, requirements, done, total };
}

function toTemplateView(template: CertTemplateView): CertTemplateView {
  return {
    label: template.label,
    required: template.required,
    needsFile: template.needsFile,
    needsVerify: template.needsVerify,
  };
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

  // P1-4: progress recorded through Sage is a student claim until an
  // instructor verifies the certification. Stamp the parent row so grant
  // reports can split verified vs self-reported outcomes; any prior
  // cert-level verification is superseded by the new unverified claim.
  await prisma.certification.update({
    where: { id: requirement.certificationId },
    data: {
      verificationStatus: OUTCOME_VERIFICATION.SELF_REPORTED,
      verifiedBy: null,
      verifiedAt: null,
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
