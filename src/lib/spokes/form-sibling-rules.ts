/**
 * Hard sibling boost/demote rules for form ranking.
 *
 * Aligns with config/sage-form-eval.json: when a query matches a known
 * confusion pattern, boost the intended form and demote forbidden siblings
 * so keyword/hybrid ranking doesn't pick the wrong twin.
 */

export interface SiblingAdjustment {
  /** Additive score delta applied after base ranking (can be negative). */
  delta: number;
}

/** Pattern → boost target + demote list. First matching rule wins per form. */
const RULES: ReadonlyArray<{
  id: string;
  pattern: RegExp;
  boost: string;
  demote: ReadonlyArray<string>;
  boostDelta?: number;
  demoteDelta?: number;
}> = [
  {
    id: "attendance-contract-promise",
    pattern:
      /\b(promise|commit|agree|sign)\b[\s\S]{0,40}\b(attend|attendance|come to class|show up)\b|\b(attend|attendance|come to class|show up)\b[\s\S]{0,40}\b(promise|commit|contract)\b/i,
    boost: "attendance-contract",
    demote: ["sign-in-sheet", "rtw-attendance"],
  },
  {
    id: "sign-in-daily",
    pattern:
      /\b(sign[- ]?in|daily attendance|sign in sheet|record (my )?attendance)\b/i,
    boost: "sign-in-sheet",
    demote: ["attendance-contract", "rtw-attendance"],
  },
  {
    id: "rtw-attendance",
    pattern:
      /\b(ready to work|rtw)\b[\s\S]{0,40}\battend|\battend[\s\S]{0,40}\b(ready to work|rtw)\b/i,
    boost: "rtw-attendance",
    demote: ["attendance-contract", "sign-in-sheet"],
  },
  {
    id: "dohs-release",
    pattern:
      /\b(dohs|department of health|health services)\b[\s\S]{0,40}\b(release|share|information)\b|\brelease\b[\s\S]{0,40}\b(dohs|department of health)\b/i,
    boost: "dohs-release",
    demote: ["auth-release"],
  },
  {
    id: "auth-release",
    pattern:
      /\b(authorization for release|release of information)\b(?![\s\S]{0,20}\bdohs\b)/i,
    boost: "auth-release",
    demote: ["dohs-release", "media-release"],
  },
  {
    id: "media-release",
    pattern: /\b(photo|video|image|media)\b[\s\S]{0,30}\b(release|use|sign)\b/i,
    boost: "media-release",
    demote: ["auth-release", "dohs-release"],
  },
  {
    id: "portfolio-tracking",
    pattern:
      /\b(track|tracking|progress|check[- ]?off|ongoing)\b[\s\S]{0,40}\bportfolio\b|\bportfolio\b[\s\S]{0,40}\b(track|tracking|progress)\b/i,
    boost: "portfolio-checklist-tracking",
    demote: ["portfolio-checklist"],
  },
  {
    id: "portfolio-onboarding",
    pattern:
      /\b(orientation|onboarding|intro|requirements)\b[\s\S]{0,40}\bportfolio\b|\bportfolio checklist\b(?![\s\S]{0,20}\btrack)/i,
    boost: "portfolio-checklist",
    demote: ["portfolio-checklist-tracking"],
  },
  {
    id: "dress-code",
    pattern: /\b(dress code|what (should|do) i wear|wear to class)\b/i,
    boost: "dress-code",
    demote: ["rights-responsibilities", "non-discrimination"],
  },
  {
    id: "rights-responsibilities",
    pattern: /\b(rights and responsibilities|my rights|what am i expected)\b/i,
    boost: "rights-responsibilities",
    demote: ["dress-code", "non-discrimination"],
  },
];

const DEFAULT_BOOST = 0.35;
const DEFAULT_DEMOTE = -0.45;

/**
 * Score adjustment for one form id given the student query.
 * Returns 0 when no sibling rule applies to this form.
 */
export function siblingScoreDelta(query: string, formId: string): number {
  const q = query.trim();
  if (!q) return 0;

  for (const rule of RULES) {
    if (!rule.pattern.test(q)) continue;
    if (formId === rule.boost) {
      return rule.boostDelta ?? DEFAULT_BOOST;
    }
    if (rule.demote.includes(formId)) {
      return rule.demoteDelta ?? DEFAULT_DEMOTE;
    }
  }
  return 0;
}

/** Apply sibling deltas to a map of formId → score (mutates values). */
export function applySiblingAdjustments(
  query: string,
  scores: Map<string, number>,
): void {
  for (const [formId, score] of scores) {
    const delta = siblingScoreDelta(query, formId);
    if (delta !== 0) scores.set(formId, Math.max(0, score + delta));
  }
}
