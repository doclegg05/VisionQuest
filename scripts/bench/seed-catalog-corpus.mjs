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
 * Does not download PDFs or write embeddings. Retrieval for the grounding
 * suite uses title + sageContextNote (keyword path, or hybrid FTS).
 */

import { createRequire } from "node:module";
import {
  expectedGroundingStorageKeys,
  loadCatalogCorpusRows,
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
  const rows = loadCatalogCorpusRows();
  const expected = expectedGroundingStorageKeys();
  const missingFromCatalog = missingStorageKeys(rows, expected);
  if (missingFromCatalog.length > 0) {
    throw new Error(
      `catalog/ is missing the grounding fixture storage keys: ${missingFromCatalog.join(", ")}`,
    );
  }

  if (dryRun) {
    console.log(
      `[DRY RUN] would upsert ${rows.length} ProgramDocument rows; grounding keys present: ${expected.join(", ")}`,
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
    log: (message) => console.log(message),
  });
  const missingFromDb = await missingGroundingKeysInDatabase({ databaseUrl, expected });
  if (missingFromDb.length > 0) {
    throw new Error(
      `Seed finished but grounding keys are still missing from ProgramDocument: ${missingFromDb.join(", ")}`,
    );
  }
  console.log(
    `Catalog corpus ready: ${result.upserted} rows, grounding keys ${expected.length}/${expected.length}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
