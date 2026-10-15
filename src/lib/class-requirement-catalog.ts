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
 */
export const CLASS_REQUIREMENT_CATALOG: readonly ClassRequirementCatalogItem[] =
  CERTIFICATIONS.map((c) => ({
    itemType: "certification" as const,
    itemId: c.id,
    title: c.shortName,
    description: c.description,
  }));
