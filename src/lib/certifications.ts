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
