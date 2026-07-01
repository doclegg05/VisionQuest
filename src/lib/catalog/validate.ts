import type { CatalogNode, CatalogNodeType } from "./schema";

export interface ValidationError { filePath: string; rule: string; message: string; }
export interface ExpectedHardFields {
  type: CatalogNodeType; title: string; vq_audience: string; vq_category: string;
  vq_storage_key?: string; vq_certification?: string; vq_platform?: string;
}
export interface ValidateContext { existingNodePaths: Set<string>; allowlistIds: string[]; }

const TYPES: CatalogNodeType[] = ["form", "program_document", "certification", "platform"];
const AUDIENCES = ["STUDENT", "TEACHER", "BOTH"];

export function validateNode(node: CatalogNode, expected: ExpectedHardFields, ctx: ValidateContext): ValidationError[] {
  const errs: ValidationError[] = [];
  const fp = node.filePath;
  const fm = node.frontmatter;
  const push = (rule: string, message: string) => errs.push({ filePath: fp, rule, message });

  if (!fm.type || !TYPES.includes(fm.type)) push("type", `type must be one of ${TYPES.join("|")}`);
  if (!fm.title) push("required", "title is required");
  if (!AUDIENCES.includes(fm.vq_audience)) push("required", "vq_audience invalid");
  if (fm.vq_status !== "draft" && fm.vq_status !== "approved") push("required", "vq_status invalid");

  for (const [k, v] of Object.entries(expected) as [keyof ExpectedHardFields, string | undefined][]) {
    if ((fm as unknown as Record<string, unknown>)[k] !== v) push("drift", `${k} drifted: catalog=${(fm as unknown as Record<string, unknown>)[k]} source=${v}`);
  }

  if (fm.vq_status === "approved" && !node.sections.whenToUse.trim()) push("empty-approved", "approved node has empty 'When to use'");

  // Cross-link integrity: every relative .md link in Related must resolve.
  const links = [...node.sections.related.matchAll(/\]\((\.\.?\/[^)]+\.md)\)/g)].map((m) => m[1]);
  for (const link of links) {
    if (!ctx.existingNodePaths.has(normalizeLink(fp, link))) push("link", `broken cross-link: ${link}`);
  }

  if (!ctx.allowlistIds.includes(fm.vq_id)) push("parity", `node not in allowlist: ${fm.vq_id}`);
  return errs;
}

function normalizeLink(fromPath: string, link: string): string {
  const parts = fromPath.split("/").slice(0, -1);
  for (const seg of link.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
