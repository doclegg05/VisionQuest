import { prisma } from "./db";
import {
  getCertificationProgress,
  READY_TO_WORK_CERT_TYPE,
  READY_TO_WORK_FAMILY_CERT_TYPES,
} from "./certifications";

async function getTemplates(certType: string) {
  // Every Ready-to-Work family row (e.g. "workkeys-ncrc", created by the D7
  // certId path) shares the one checklist stored under "ready-to-work";
  // no templates exist under the other family labels.
  const templateCertType = READY_TO_WORK_FAMILY_CERT_TYPES.includes(certType)
    ? READY_TO_WORK_CERT_TYPE
    : certType;
  return prisma.certTemplate.findMany({
    where: { certType: templateCertType },
    select: {
      id: true,
      required: true,
      needsFile: true,
      needsVerify: true,
    },
  });
}

async function getRequirements(certificationId: string) {
  return prisma.certRequirement.findMany({
    where: { certificationId },
    select: {
      id: true,
      templateId: true,
      completed: true,
      verifiedBy: true,
      fileId: true,
    },
  });
}

export async function syncCertificationRequirements(certificationId: string, certType: string) {
  const templates = await getTemplates(certType);
  const requirements = await getRequirements(certificationId);
  const existingTemplateIds = new Set(requirements.map((entry) => entry.templateId));
  const missingTemplates = templates.filter((template) => !existingTemplateIds.has(template.id));

  if (missingTemplates.length > 0) {
    await prisma.certRequirement.createMany({
      data: missingTemplates.map((template) => ({
        certificationId,
        templateId: template.id,
      })),
      skipDuplicates: true,
    });
  }

  return {
    templates,
    requirements: missingTemplates.length > 0 ? await getRequirements(certificationId) : requirements,
  };
}

export async function recomputeCertificationStatus(certificationId: string, certType: string) {
  const { templates, requirements } = await syncCertificationRequirements(certificationId, certType);
  const { isComplete } = getCertificationProgress(templates, requirements);
  const nextStatus = isComplete ? "completed" : "in_progress";

  const current = await prisma.certification.findUnique({
    where: { id: certificationId },
    select: {
      status: true,
      completedAt: true,
    },
  });

  if (!current) {
    throw new Error(`Certification ${certificationId} not found.`);
  }

  if (
    current.status !== nextStatus ||
    (nextStatus === "completed" && !current.completedAt) ||
    (nextStatus !== "completed" && current.completedAt)
  ) {
    return prisma.certification.update({
      where: { id: certificationId },
      data: {
        status: nextStatus,
        completedAt: isComplete ? new Date() : null,
      },
      include: { requirements: true },
    });
  }

  return prisma.certification.findUniqueOrThrow({
    where: { id: certificationId },
    include: { requirements: true },
  });
}

export async function recomputeCertificationStatusesForType(certType: string) {
  // The teacher template routes pass "ready-to-work", the only certType that
  // holds templates. Every family row holds that checklist, so a change to it
  // recomputes the whole family.
  const certifications = await prisma.certification.findMany({
    where: {
      certType:
        certType === READY_TO_WORK_CERT_TYPE ? { in: [...READY_TO_WORK_FAMILY_CERT_TYPES] } : certType,
    },
    select: { id: true },
  });

  await Promise.all(
    certifications.map((certification) => recomputeCertificationStatus(certification.id, certType))
  );
}
