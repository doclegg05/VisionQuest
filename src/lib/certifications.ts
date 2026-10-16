/**
 * The certType every Certification row was hardcoded to before D7
 * (2026-09-07, src/app/api/certifications/route.ts) — still the default
 * when the create path is given no catalog certId.
 */
export const READY_TO_WORK_CERT_TYPE = "ready-to-work";

/**
 * The Ready-to-Work credential family: the legacy default certType plus
 * every catalog id (src/lib/spokes/certifications.ts) that goal links use
 * to reference the same underlying "Ready to Work" certification, so a
 * Certification row created under ANY of these ids is still found by a
 * reader looking for "the student's Ready-to-Work certification."
 *
 * "workkeys-ncrc" (ACT WorkKeys NCRC) is the only catalog entry that has
 * denoted this certificate track — see the soft-match fallback comment in
 * src/lib/goal-evidence.ts, which this constant now backs, for the legacy
 * (pre-D7) rows it still needs to cover.
 */
export const READY_TO_WORK_FAMILY_CERT_TYPES: readonly string[] = [
  READY_TO_WORK_CERT_TYPE,
  "workkeys-ncrc",
];

/**
 * Whether a class requirement for certification `itemId` is satisfied by
 * the certTypes of a student's completed Certification rows. An exact
 * certType match counts first. A Ready to Work requirement
 * (READY_TO_WORK_CERT_TYPE) is also met by a completed row under any
 * family certType, because every family row holds the Ready to Work
 * checklist whatever its label.
 *
 * Every other requirement, "workkeys-ncrc" included, is exact-match only.
 * Owner decision 2026-10-15: finishing the Ready to Work checklist is not
 * evidence of passing the WorkKeys NCRC exam, which the program treats as a
 * separate prerequisite. This deliberately differs from the goal-evidence
 * soft match (src/lib/goal-evidence.ts), where a "workkeys-ncrc" goal link
 * falls back to the "ready-to-work" row.
 */
export function isCertificationRequirementMet(
  itemId: string,
  completedCertTypes: ReadonlySet<string>,
): boolean {
  if (completedCertTypes.has(itemId)) return true;
  return (
    itemId === READY_TO_WORK_CERT_TYPE &&
    READY_TO_WORK_FAMILY_CERT_TYPES.some((certType) => completedCertTypes.has(certType))
  );
}

export interface CertificationTemplateRule {
  id: string;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
}

export interface CertificationRequirementState {
  id?: string | null;
  templateId: string;
  completed: boolean;
  verifiedBy: string | null;
  fileId: string | null;
}

export function isRequirementSatisfied(
  template: CertificationTemplateRule,
  requirement: CertificationRequirementState | undefined
): boolean {
  if (!template.required) return true;
  if (!requirement?.completed) return false;
  if (template.needsFile && !requirement.fileId) return false;
  if (template.needsVerify && !requirement.verifiedBy) return false;
  return true;
}

export function getCertificationProgress(
  templates: CertificationTemplateRule[],
  requirements: CertificationRequirementState[]
) {
  const requiredTemplates = templates.filter((template) => template.required);
  const total = requiredTemplates.length;
  const done = requiredTemplates.filter((template) => {
    const requirement = requirements.find((entry) => entry.templateId === template.id);
    return isRequirementSatisfied(template, requirement);
  }).length;

  return {
    done,
    total,
    isComplete: total > 0 && done === total,
  };
}

export function validateRequirementUpdate(
  template: CertificationTemplateRule,
  nextState: CertificationRequirementState
): string | null {
  if (nextState.completed && template.needsFile && !nextState.fileId) {
    return "Attach the required file before marking this item complete.";
  }

  return null;
}
