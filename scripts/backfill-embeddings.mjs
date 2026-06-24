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
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const FORCE = process.argv.includes("--force");
const ALL = process.argv.includes("--all");

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { backfillProgramDocumentEmbeddings } = await import("../src/lib/sage/backfill-embeddings.ts");

  console.log(`Backfilling embeddings${FORCE ? " (--force)" : ""}${ALL ? " (--all)" : ""}…`);
  const tally = await backfillProgramDocumentEmbeddings({
    force: FORCE,
    all: ALL,
    onProgress: (message) => console.log(message),
  });

  console.log(
    `\nDone: ${tally.embedded} embedded, ${tally.skipped} skipped, ${tally.noText} without body text, ${tally.errors} errors (${tally.total} total)`,
  );
  await prisma.$disconnect();
  if (tally.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
