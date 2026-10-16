import { READY_TO_WORK_CERT_TYPE } from "./certifications";
import { CERTIFICATIONS } from "./spokes/certifications";

export interface ClassRequirementCatalogItem {
  itemType: "certification";
  itemId: string;
  title: string;
  description: string;
}

/**
 * Items an instructor can add to a class requirement matrix
 * (src/components/teacher/ClassRequirementEditor.tsx).
 *
 * Platforms (LMS systems) are intentionally excluded — they're how students
 * access courses, not courses themselves. Several platforms also duplicated
 * certifications (e.g. "Bring Your A Game" platform vs BYAG certification).
 *
 * Ready to Work comes first and uses READY_TO_WORK_CERT_TYPE, the certType
 * the app stores on every student's Ready to Work certification. It is not
 * a catalog id, so it is listed here directly.
 */
export const CLASS_REQUIREMENT_CATALOG: readonly ClassRequirementCatalogItem[] = [
  {
    itemType: "certification",
    itemId: READY_TO_WORK_CERT_TYPE,
    title: "Ready to Work",
    description:
      "The SPOKES Ready to Work checklist: attendance, resume, cover letter, mock interview, and the other program steps.",
  },
  ...CERTIFICATIONS.map((c) => ({
    itemType: "certification" as const,
    itemId: c.id,
    title: c.shortName,
    description: c.description,
  })),
];
