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
import { extractTextFromBuffer, containsPII } from "./extract";
import { embedProgramDocument } from "./document-embedding";

const EXTRACTABLE_EXTS = new Set([".pdf", ".docx", ".txt", ".md"]);

export interface BackfillOptions {
  /** Re-embed documents that already have an embedding. */
  force?: boolean;
  /** Widen from Sage-visible docs to every active document. */
  all?: boolean;
  /** Per-document progress callback (used by the CLI script for logging). */
  onProgress?: (message: string) => void;
}

export interface BackfillTally {
  total: number;
  embedded: number;
  skipped: number;
  noText: number;
  errors: number;
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
  const { force = false, all = false, onProgress } = options;

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
      let text: string | null = null;
      if (extractable) {
        const download = await downloadFile(doc.storageKey);
        if (download) {
          const extraction = await extractTextFromBuffer(download.buffer, ext, {
            maxChars: 12000,
            maxPages: 6,
          });
          const candidate = extraction?.text ?? null;
          text = candidate && !containsPII(candidate) ? candidate : null;
        }
      }
      if (!text) tally.noText++;

      const { chunkCount } = await embedProgramDocument(doc.id, {
        title: doc.title,
        sageContextNote: doc.sageContextNote,
        text,
        usage: { studentId: null, callSite: "sage_embedding_backfill" },
      });
      tally.embedded++;
      onProgress?.(
        `[${index + 1}/${docs.length}] embedded ${doc.title} (${chunkCount} chunks${text ? "" : ", no body text"})`,
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
