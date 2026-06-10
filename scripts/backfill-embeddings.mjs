#!/usr/bin/env node

/**
 * Idempotent embedding backfill for ProgramDocument (Phase 1 semantic RAG).
 *
 * For each Sage-visible document (usedBySage AND isActive; --all widens to
 * every active doc): downloads the body from storage, extracts text
 * (pdf/docx/txt/md), and writes the doc-level vector + chunk embeddings via
 * embedProgramDocument(). Docs that already have an embedding are skipped
 * unless --force (docs with an extractable type but zero chunks are
 * re-processed so partial earlier runs heal themselves).
 *
 * Usage:
 *   npm run sage:rag:backfill
 *   npm run sage:rag:backfill -- --all
 *   npm run sage:rag:backfill -- --force
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const FORCE = process.argv.includes("--force");
const ALL = process.argv.includes("--all");
const EXTRACTABLE_EXTS = new Set([".pdf", ".docx", ".txt", ".md"]);

function extOf(storageKey) {
  const dot = storageKey.lastIndexOf(".");
  return dot === -1 ? "" : storageKey.slice(dot).toLowerCase();
}

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { downloadFile } = await import("../src/lib/storage.ts");
  const { extractTextFromBuffer, containsPII } = await import("../src/lib/sage/extract.ts");
  const { embedProgramDocument } = await import("../src/lib/sage/document-embedding.ts");

  const docs = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.title, d."storageKey", d."sageContextNote",
            (d.embedding IS NOT NULL) AS "hasEmbedding",
            COUNT(c.id)::int AS "chunkCount"
     FROM "visionquest"."ProgramDocument" d
     LEFT JOIN "visionquest"."DocumentChunk" c ON c."documentId" = d.id
     WHERE d."isActive" = true ${ALL ? "" : 'AND d."usedBySage" = true'}
     GROUP BY d.id
     ORDER BY d.title`,
  );

  const tally = { embedded: 0, skipped: 0, noText: 0, errors: 0 };
  console.log(`Backfilling embeddings for ${docs.length} documents${FORCE ? " (--force)" : ""}…`);

  for (const [index, doc] of docs.entries()) {
    const ext = extOf(doc.storageKey);
    const extractable = EXTRACTABLE_EXTS.has(ext);

    // Idempotency: an embedded doc is done unless it should have chunks but
    // has none (a partial earlier run) — or --force re-embeds everything.
    if (doc.hasEmbedding && !FORCE && (doc.chunkCount > 0 || !extractable)) {
      tally.skipped++;
      continue;
    }

    try {
      let text = null;
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
      console.log(
        `[${index + 1}/${docs.length}] embedded ${doc.title} (${chunkCount} chunks${text ? "" : ", no body text"})`,
      );
    } catch (error) {
      tally.errors++;
      console.error(
        `[${index + 1}/${docs.length}] ERROR ${doc.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    `\nDone: ${tally.embedded} embedded, ${tally.skipped} skipped, ${tally.noText} without body text, ${tally.errors} errors`,
  );
  await prisma.$disconnect();
  if (tally.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
