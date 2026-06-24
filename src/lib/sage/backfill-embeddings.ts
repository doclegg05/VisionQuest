/**
 * Idempotent embedding backfill for ProgramDocument (Phase 1 semantic RAG).
 *
 * Shared by scripts/backfill-embeddings.mjs (manual/local) and
 * POST /api/internal/rag/backfill (one-curl prod trigger).
 *
 * For each Sage-visible document (usedBySage AND isActive; `all` widens to
 * every active doc): downloads the body from storage, extracts text
 * (pdf/docx/txt/md), and writes the doc-level vector + chunk embeddings via
 * embedProgramDocument(). Docs that already have an embedding are skipped
 * unless `force`.
 */

import { prisma } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { extractPagesFromBuffer, containsPII } from "./extract";
import { embedProgramDocument } from "./document-embedding";
import { chunkPages } from "./chunking";

const EXTRACTABLE_EXTS = new Set([".pdf", ".docx", ".txt", ".md"]);

export interface BackfillOptions {
  /** Re-embed documents that already have an embedding. */
  force?: boolean;
  /** Widen from Sage-visible docs to every active document. */
  all?: boolean;
  /** Per-document progress callback (used by the CLI script for logging). */
  onProgress?: (message: string) => void;
  /**
   * When true, log a per-doc manifest and summary but do NOT call
   * embedProgramDocument. No storage writes occur in dry-run mode.
   */
  dryRun?: boolean;
}

export interface BackfillTally {
  total: number;
  embedded: number;
  skipped: number;
  noText: number;
  errors: number;
}

// ── Dry-run manifest types ────────────────────────────────────────────────────

export interface ManifestDocEntry {
  id: string;
  title: string;
  ext: string;
  pageCount: number;
  estChunks: number;
  extractable: boolean;
}

export interface ManifestSkipEntry {
  id: string;
  title: string;
  reason: string;
}

export interface DryRunManifest {
  docs: ManifestDocEntry[];
  totalEstChunks: number;
  skipped: ManifestSkipEntry[];
}

interface BackfillDocRow {
  id: string;
  title: string;
  storageKey: string;
  sageContextNote: string | null;
  hasEmbedding: boolean;
  chunkCount: number;
}

function extOf(storageKey: string): string {
  const dot = storageKey.lastIndexOf(".");
  return dot === -1 ? "" : storageKey.slice(dot).toLowerCase();
}

export async function backfillProgramDocumentEmbeddings(
  options: BackfillOptions = {},
): Promise<BackfillTally> {
  const { force = false, all = false, onProgress, dryRun = false } = options;

  const docs = await prisma.$queryRawUnsafe<BackfillDocRow[]>(
    `SELECT d.id, d.title, d."storageKey", d."sageContextNote",
            (d.embedding IS NOT NULL) AS "hasEmbedding",
            COUNT(c.id)::int AS "chunkCount"
     FROM "visionquest"."ProgramDocument" d
     LEFT JOIN "visionquest"."DocumentChunk" c ON c."documentId" = d.id
     WHERE d."isActive" = true ${all ? "" : 'AND d."usedBySage" = true'}
     GROUP BY d.id
     ORDER BY d.title`,
  );

  const tally: BackfillTally = {
    total: docs.length,
    embedded: 0,
    skipped: 0,
    noText: 0,
    errors: 0,
  };

  // Dry-run: build manifest without writing anything.
  if (dryRun) {
    const manifest = await buildDryRunManifest(docs, onProgress);
    onProgress?.(JSON.stringify(manifest, null, 2));
    // Tally: treat every manifest doc as "skipped" so callers can detect the mode.
    tally.total = docs.length;
    tally.skipped = manifest.docs.length;
    // skipped entries in manifest are docs with no usable text — noText equivalents.
    tally.noText = manifest.skipped.length;
    return tally;
  }

  for (const [index, doc] of docs.entries()) {
    const ext = extOf(doc.storageKey);
    const extractable = EXTRACTABLE_EXTS.has(ext);

    // Idempotency: doc vector + chunks are written in one transaction, so an
    // embedded doc is always complete. `force` re-embeds everything.
    if (doc.hasEmbedding && !force) {
      tally.skipped++;
      continue;
    }

    try {
      let pages: { pageNumber: number; text: string }[] | null = null;
      if (extractable) {
        const download = await downloadFile(doc.storageKey);
        if (download) {
          const extraction = await extractPagesFromBuffer(download.buffer, ext);
          // Flatten pages to a single string for PII check, then discard if PII found.
          if (extraction) {
            const fullText = extraction.pages.map((p) => p.text).join("\n");
            pages = !containsPII(fullText) ? extraction.pages : null;
          }
        }
      }
      if (!pages) tally.noText++;

      const { chunkCount } = await embedProgramDocument(doc.id, {
        title: doc.title,
        sageContextNote: doc.sageContextNote,
        pages: pages ?? undefined,
        usage: { studentId: null, callSite: "sage_embedding_backfill" },
      });
      tally.embedded++;
      onProgress?.(
        `[${index + 1}/${docs.length}] embedded ${doc.title} (${chunkCount} chunks${pages ? "" : ", no body text"})`,
      );
    } catch (error) {
      tally.errors++;
      onProgress?.(
        `[${index + 1}/${docs.length}] ERROR ${doc.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return tally;
}

// ── Dry-run manifest builder ──────────────────────────────────────────────────

/**
 * Build a manifest of what the backfill would process.
 *
 * Dry-run couples to storage availability: we download and extract each
 * candidate doc so the operator sees REAL pageCount/estChunks before the
 * actual run. This is intentional — it makes the manifest a genuine prod
 * pre-flight rather than a rough estimate.
 *
 * Guarantees:
 * - No embedProgramDocument calls — no embeddings, no DB writes.
 * - Non-extractable, undownloadable, or text-empty docs go to `skipped[]`
 *   with a clear reason — no silent drops.
 */
export async function buildDryRunManifest(
  docs: BackfillDocRow[],
  onProgress?: (message: string) => void,
): Promise<DryRunManifest> {
  const manifestDocs: ManifestDocEntry[] = [];
  const skipped: ManifestSkipEntry[] = [];

  for (const doc of docs) {
    const ext = extOf(doc.storageKey);
    const extractable = EXTRACTABLE_EXTS.has(ext);

    if (!extractable) {
      skipped.push({
        id: doc.id,
        title: doc.title,
        reason: ext
          ? `non-extractable extension (${ext}) — image-only or unsupported format`
          : "no file extension — cannot determine format",
      });
      onProgress?.(`  SKIP ${doc.title}: non-extractable (${ext || "no ext"})`);
      continue;
    }

    // Download + extract to compute real page and chunk counts.
    try {
      const download = await downloadFile(doc.storageKey);
      if (!download) {
        skipped.push({
          id: doc.id,
          title: doc.title,
          reason: "file not found in storage — cannot download",
        });
        onProgress?.(`  SKIP ${doc.title}: not found in storage`);
        continue;
      }

      const extraction = await extractPagesFromBuffer(download.buffer, ext);
      if (!extraction || extraction.pages.length === 0) {
        skipped.push({
          id: doc.id,
          title: doc.title,
          reason: "extraction yielded no text — unsupported format or blank document",
        });
        onProgress?.(`  SKIP ${doc.title}: no extractable text`);
        continue;
      }

      const chunks = chunkPages(extraction.pages);
      const pageCount = extraction.pages.length;
      const estChunks = chunks.length;

      manifestDocs.push({
        id: doc.id,
        title: doc.title,
        ext,
        pageCount,
        estChunks,
        extractable: true,
      });
      onProgress?.(`  OK   ${doc.title} (${ext}, ${pageCount}p, ~${estChunks} chunks)`);
    } catch (err) {
      skipped.push({
        id: doc.id,
        title: doc.title,
        reason: `download/extraction error: ${err instanceof Error ? err.message : String(err)}`,
      });
      onProgress?.(`  SKIP ${doc.title}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    docs: manifestDocs,
    totalEstChunks: manifestDocs.reduce((sum, d) => sum + d.estChunks, 0),
    skipped,
  };
}
