import type { CatalogNode, FormRoutingEntry, FormRoutingOverlay } from "./schema";

export interface DocUpdate {
  docId: string;
  storageKey: string;
  newNote: string;
}

// whenToUse-only: this note feeds BOTH the doc embedding (DB-side semantic
// index) and the prompt summary Sage sees for a retrieved doc. Negation
// (whenNotToUse) must never enter an embedding — a keyword/vector matcher
// reads "NOT the sign-in sheet" as the literal tokens "sign-in sheet", which
// pollutes this doc with its sibling's queries (measured regression).
export function buildDocNote(node: CatalogNode): string {
  const parts = [node.frontmatter.description, node.sections.whenToUse]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(" ");
}

// Answer-time only — NEVER fed into form-search.ts's retrieval index (see the
// header comment there for why). Both directions are included because Sage
// reads this at answer time to disambiguate already-retrieved candidates;
// negation is exactly the useful signal here, just not in an index.
export function buildFormRoutingOverlay(approvedNodes: CatalogNode[]): FormRoutingOverlay {
  const entries: Record<string, FormRoutingEntry> = {};
  for (const node of approvedNodes) {
    if (node.frontmatter.type !== "form" || node.frontmatter.vq_status !== "approved") continue;
    entries[node.frontmatter.vq_id] = {
      formId: node.frontmatter.vq_id,
      whenToUse: (node.sections.whenToUse ?? "").trim(),
      whenNotToUse: (node.sections.whenNotToUse ?? "").trim(),
      tags: node.frontmatter.tags ?? [],
    };
  }
  return { version: 1, entries };
}

// Dual-sink: ANY approved node carrying a vq_storage_key that matches a ProgramDocument
// gets its curated note synced — forms that are also program docs, plus program_document nodes.
// Multiple nodes can be backed by ONE physical PDF (e.g. two form ids sharing a storageKey);
// their notes are MERGED into a single update so the one ProgramDocument note is not clobbered.
export function buildDocSyncManifest(
  approvedNodes: CatalogNode[],
  dbDocsByStorageKey: Map<string, { id: string }>,
): DocUpdate[] {
  const byKey = new Map<string, { docId: string; storageKey: string; notes: string[] }>();
  for (const node of approvedNodes) {
    if (node.frontmatter.vq_status !== "approved") continue;
    const key = node.frontmatter.vq_storage_key;
    if (!key) continue;
    const row = dbDocsByStorageKey.get(key);
    if (!row) continue;
    const note = buildDocNote(node);
    const entry = byKey.get(key) ?? { docId: row.id, storageKey: key, notes: [] };
    if (note && !entry.notes.includes(note)) entry.notes.push(note);
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ docId, storageKey, notes }) => ({
    docId,
    storageKey,
    newNote: notes.join(" — "),
  }));
}
