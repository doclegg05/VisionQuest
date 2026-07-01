import type { CatalogNode } from "./schema";
import { buildDocSyncManifest } from "./sync";

export interface DriftFinding { docId: string; storageKey: string; expected: string; actual: string | null; }

export function findNoteDrift(
  approvedNodes: CatalogNode[],
  dbRows: { id: string; storageKey: string; sageContextNote: string | null }[],
): DriftFinding[] {
  const byStorageKey = new Map(dbRows.map((r) => [r.storageKey, { id: r.id }]));
  const noteByDocId = new Map(dbRows.map((r) => [r.id, r.sageContextNote]));
  const manifest = buildDocSyncManifest(approvedNodes, byStorageKey); // same merged expected note as sync
  const out: DriftFinding[] = [];
  for (const u of manifest) {
    const actual = noteByDocId.get(u.docId) ?? null;
    if ((actual ?? "") !== u.newNote) out.push({ docId: u.docId, storageKey: u.storageKey, expected: u.newNote, actual });
  }
  return out;
}
