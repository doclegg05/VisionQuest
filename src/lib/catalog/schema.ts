export type CatalogNodeType = "form" | "program_document" | "certification" | "platform";
export type CatalogStatus = "draft" | "approved";
export type CatalogAudience = "STUDENT" | "TEACHER" | "BOTH";

export interface CatalogFrontmatter {
  type: CatalogNodeType;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  timestamp: string; // YYYY-MM-DD
  vq_id: string;
  vq_audience: CatalogAudience;
  vq_category: string;
  vq_certification?: string;
  vq_platform?: string;
  vq_storage_key?: string;
  vq_status: CatalogStatus;
}

export interface CatalogNodeSections {
  whenToUse: string;
  whenNotToUse: string;
  related: string;
}

export interface CatalogNode {
  frontmatter: CatalogFrontmatter;
  sections: CatalogNodeSections;
  body: string;
  filePath: string;
}

export interface FormRoutingEntry {
  formId: string;
  whenToUse: string;
  /**
   * Names sibling forms this one is commonly confused with. NEVER fed into a
   * retrieval index (negation is invisible to keyword/vector matching — see
   * form-search.ts). Answer-time only: consumed via notes.ts to help Sage
   * disambiguate already-retrieved candidates.
   */
  whenNotToUse: string;
  tags: string[];
}

export interface FormRoutingOverlay {
  version: 1;
  entries: Record<string, FormRoutingEntry>;
}
