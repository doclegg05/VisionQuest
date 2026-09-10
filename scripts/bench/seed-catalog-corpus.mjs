#!/usr/bin/env node

/**
 * Put the git-tracked catalog/ OKF layer into ProgramDocument so hermetic
 * CI (and a local migrated database) can run sage-grounding.
 *
 *   DATABASE_URL="postgres://…/visionquest_local" npx tsx scripts/bench/seed-catalog-corpus.mjs
 *
 * Reads ADMIN_DATABASE_URL first, then DATABASE_URL. Idempotent: upserts on
 * storageKey. The same two safety gates as scripts/bench/seed-cohort.ts —
 * local/CI hosts only, and a production-shaped host is refused with no override.
 *
 * Default: no PDFs or embeddings. --answer-quality adds two test-only source
 * references. --embed explicitly calls the configured embedding provider for
 * this local/CI corpus so the answer calibration can exercise hybrid retrieval.
 */

import { createRequire } from "node:module";
import {
  expectedGroundingStorageKeys,
  loadCatalogCorpusRows,
  loadAnswerQualityCorpusRows,
  missingGroundingKeysInDatabase,
  missingStorageKeys,
  seedCatalogCorpus,
} from "./lib/catalog-corpus.mjs";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
const { assertSafeE2eSeedTarget } = await import("../../src/lib/e2e-seed-guard.ts");

loadEnvConfig(process.cwd(), true);

const PRODUCTION_SHAPED = [/supabase\./iu, /\.render\.com$/iu, /neon\.tech$/iu, /prod/iu];

function assertNotProduction(databaseUrl) {
  let host;
  let database;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    database = url.pathname.replace(/^\//u, "");
  } catch {
    throw new Error("DATABASE_URL is not a parseable connection string.");
  }

  for (const pattern of PRODUCTION_SHAPED) {
    if (pattern.test(host) || pattern.test(database)) {
      throw new Error(
        `Refusing to seed the catalog corpus against host "${host}" (database ` +
          `"${database}"): it matches ${pattern}, which this script treats as production. ` +
          "There is no override for this check — point DATABASE_URL at a local or CI " +
          "database instead.",
      );
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const answerQuality = process.argv.includes("--answer-quality");
  const rows = answerQuality ? loadAnswerQualityCorpusRows() : loadCatalogCorpusRows();
  const expected = expectedGroundingStorageKeys(answerQuality ? "config/sage-answer-quality-eval.json" : undefined);
  const missingFromCatalog = missingStorageKeys(rows, expected);
  if (missingFromCatalog.length > 0) {
    throw new Error(
      `catalog/ is missing the grounding fixture storage keys: ${missingFromCatalog.join(", ")}`,
    );
  }

  if (dryRun) {
    console.log(
      `[DRY RUN] would upsert ${rows.length} ProgramDocument rows${process.argv.includes("--embed") ? " and generate document embeddings" : ""}; grounding keys present: ${expected.join(", ")}`,
    );
    return;
  }

  const databaseUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "Neither ADMIN_DATABASE_URL nor DATABASE_URL is set — pass one inline or provide .env.local.",
    );
  }

  assertNotProduction(databaseUrl);
  assertSafeE2eSeedTarget(databaseUrl, {
    allowRemote: process.argv.includes("--allow-remote"),
  });

  const result = await seedCatalogCorpus({
    databaseUrl,
    rows,
    log: (message) => console.log(message),
  });
  const missingFromDb = await missingGroundingKeysInDatabase({ databaseUrl, expected });
  if (missingFromDb.length > 0) {
    throw new Error(
      `Seed finished but grounding keys are still missing from ProgramDocument: ${missingFromDb.join(", ")}`,
    );
  }
  if (process.argv.includes("--embed")) {
    // Bind every provider configuration/audit read to the guarded seed target
    // before importing application modules. ADMIN_DATABASE_URL may have been
    // the only explicit override while .env.local supplied a different URL.
    process.env.DATABASE_URL = databaseUrl;
    process.env.DIRECT_URL = databaseUrl;
    process.env.ADMIN_DATABASE_URL = databaseUrl;
    const { embedTextsWithModel, toVectorLiteral } = await import("../../src/lib/ai/embeddings.ts");
    const { buildDocEmbeddingText } = await import("../../src/lib/sage/document-embedding.ts");
    const { prisma, prismaAdmin } = await import("../../src/lib/db.ts");
    try {
      const embedded = await embedTextsWithModel(rows.map(row => buildDocEmbeddingText(row.title, row.sageContextNote)), {
        taskType: "RETRIEVAL_DOCUMENT",
        usage: { callSite: "sage_ci_corpus_embedding", sensitivity: "public_program", studentId: null },
      });
      if (embedded.vectors.length !== rows.length) throw new Error("Incomplete CI corpus embedding batch");
      for (const [index, row] of rows.entries()) {
        await prismaAdmin.$executeRaw`
          UPDATE visionquest."ProgramDocument"
          SET embedding=${toVectorLiteral(embedded.vectors[index])}::vector,
              "embeddingModel"=${embedded.model}
          WHERE "storageKey"=${row.storageKey}`;
      }
      console.log(`Embedded ${rows.length} CI references with ${embedded.model}.`);
    } finally {
      await Promise.all([prisma.$disconnect(), prismaAdmin.$disconnect()]);
    }
  }
  console.log(
    `Catalog corpus ready: ${result.upserted} rows, grounding keys ${expected.length}/${expected.length}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
