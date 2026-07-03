#!/usr/bin/env node

/**
 * Idempotent embedding backfill for ProgramDocument (Phase 1 semantic RAG).
 *
 * Thin CLI wrapper around src/lib/sage/backfill-embeddings.ts — the same flow
 * is exposed in prod as POST /api/internal/rag/backfill (Bearer CRON_SECRET).
 *
 * Usage:
 *   npm run sage:rag:backfill
 *   npm run sage:rag:backfill -- --all
 *   npm run sage:rag:backfill -- --force
 *   npm run sage:rag:backfill -- --reembed   # re-embed model-stale docs + memories
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const FORCE = process.argv.includes("--force");
const ALL = process.argv.includes("--all");
const DRY_RUN = process.argv.includes("--dry-run");
const REEMBED = process.argv.includes("--reembed");

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { backfillProgramDocumentEmbeddings, backfillSageMemoryEmbeddings } = await import(
    "../src/lib/sage/backfill-embeddings.ts"
  );

  if (DRY_RUN) {
    console.log(`Dry-run manifest${ALL ? " (--all)" : ""}… (no storage writes)`);
  } else {
    console.log(
      `Backfilling embeddings${FORCE ? " (--force)" : ""}${ALL ? " (--all)" : ""}${REEMBED ? " (--reembed)" : ""}…`,
    );
  }

  const tally = await backfillProgramDocumentEmbeddings({
    force: FORCE,
    all: ALL,
    reembed: REEMBED,
    dryRun: DRY_RUN,
    onProgress: (message) => console.log(message),
  });

  if (DRY_RUN) {
    console.log(
      `\nDry-run complete: ${tally.skipped} docs surveyed, ${tally.noText} would be skipped (no extractable text)`,
    );
  } else {
    console.log(
      `\nDone: ${tally.embedded} embedded, ${tally.skipped} skipped, ${tally.noText} without body text, ${tally.errors} errors (${tally.total} total)`,
    );
  }

  // Re-embed mode also refreshes model-stale Sage memories (skipped in dry-run).
  if (REEMBED && !DRY_RUN) {
    console.log("\nRe-embedding model-stale Sage memories…");
    const memTally = await backfillSageMemoryEmbeddings({
      onProgress: (message) => console.log(message),
    });
    console.log(
      `Memories: ${memTally.embedded} re-embedded, ${memTally.errors} errors (${memTally.total} stale)`,
    );
    if (memTally.errors > 0) process.exitCode = 1;
  }

  await prisma.$disconnect();
  if (tally.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
