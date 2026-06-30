import type { CatalogNode, FormRoutingEntry, FormRoutingOverlay } from "./schema";

export interface DocUpdate {
  docId: string;
  storageKey: string;
  newNote: string;
}

export function buildDocNote(node: CatalogNode): string {
  const parts = [node.frontmatter.description, node.sections.whenToUse, node.sections.whenNotToUse]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(" ");
}

export function buildFormRoutingOverlay(approvedNodes: CatalogNode[]): FormRoutingOverlay {
  const entries: Record<string, FormRoutingEntry> = {};
  for (const node of approvedNodes) {
    if (node.frontmatter.type !== "form" || node.frontmatter.vq_status !== "approved") continue;
    entries[node.frontmatter.vq_id] = {
      formId: node.frontmatter.vq_id,
      whenToUse: [node.sections.whenToUse, node.sections.whenNotToUse]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .join(" "),
      tags: node.frontmatter.tags ?? [],
    };
  }
  return { version: 1, entries };
}

// Dual-sink: ANY approved node carrying a vq_storage_key that matches a ProgramDocument
// gets its curated note synced — forms that are also program docs, plus program_document nodes.
export function buildDocSyncManifest(
  approvedNodes: CatalogNode[],
  dbDocsByStorageKey: Map<string, { id: string }>,
): DocUpdate[] {
  const out: DocUpdate[] = [];
  for (const node of approvedNodes) {
    if (node.frontmatter.vq_status !== "approved") continue;
    const key = node.frontmatter.vq_storage_key;
    if (!key) continue;
    const row = dbDocsByStorageKey.get(key);
    if (!row) continue;
    out.push({ docId: row.id, storageKey: key, newNote: buildDocNote(node) });
  }
  return out;
}
