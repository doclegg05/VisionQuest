import matter from "gray-matter";
import type { SpokesForm } from "@/lib/spokes/forms";
import { buildFormDownloadUrl } from "@/lib/spokes/forms";
import type { CatalogAudience, CatalogFrontmatter } from "./schema";

export function mapFormAudience(a: SpokesForm["audience"]): CatalogAudience {
  if (a === "instructor") return "TEACHER";
  if (a === "student") return "STUDENT";
  return "BOTH";
}

export function slugifyStorageKey(storageKey: string): string {
  const base = (storageKey.split("/").pop() ?? storageKey).replace(/\.[^.]+$/, "");
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const EMPTY_BODY = `## When to use\n\n## When NOT to use\n\n## Related\n`;

// Strip undefined/null before YAML dump — js-yaml throws on undefined, and we
// want absent optional fields to simply not appear in the frontmatter.
function emit(fm: CatalogFrontmatter, body: string): string {
  const data = Object.fromEntries(
    Object.entries(fm as unknown as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null),
  );
  return matter.stringify(body, data);
}

export function buildFormNodeMarkdown(form: SpokesForm): string {
  const fm: CatalogFrontmatter = {
    type: "form",
    title: form.title,
    description: form.description,
    resource: buildFormDownloadUrl(form, "view"),
    tags: [],
    timestamp: "2026-06-30",
    vq_id: form.id,
    vq_audience: mapFormAudience(form.audience),
    vq_category: form.category,
    vq_storage_key: form.storageKey ?? undefined,
    vq_status: "draft",
  };
  return emit(fm, EMPTY_BODY);
}

export interface ProgramDocSource {
  title: string;
  storageKey: string;
  category: string;
  audience: string; // already STUDENT|TEACHER|BOTH from the DB
  certificationId: string | null;
  platformId: string | null;
}

export function buildProgramDocNodeMarkdown(doc: ProgramDocSource): string {
  const fm: CatalogFrontmatter = {
    type: "program_document",
    title: doc.title,
    description: "",
    resource: doc.storageKey,
    tags: [],
    timestamp: "2026-06-30",
    vq_id: slugifyStorageKey(doc.storageKey),
    vq_audience: doc.audience as CatalogAudience,
    vq_category: doc.category,
    vq_certification: doc.certificationId ?? undefined,
    vq_platform: doc.platformId ?? undefined,
    vq_storage_key: doc.storageKey,
    vq_status: "draft",
  };
  return emit(fm, EMPTY_BODY);
}

export function buildTaxonomyNodeMarkdown(
  type: "certification" | "platform",
  id: string,
  title: string,
): string {
  const fm: CatalogFrontmatter = {
    type, title, description: "", resource: "", tags: [], timestamp: "2026-06-30",
    vq_id: id, vq_audience: "BOTH", vq_category: type, vq_status: "draft",
  };
  return emit(fm, EMPTY_BODY);
}
