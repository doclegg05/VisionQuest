/**
 * Benchmark: sage-grounding. See config/benchmarks/sage-grounding.json.
 *
 * Self-test:
 *   GEMINI_API_KEY=... DATABASE_URL=... node --import tsx scripts/bench/suites/sage-grounding.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { runChatHarnessFamily, passRateFromBucket } from "./lib/chat-harness-family.mjs";
import {
  expectedGroundingStorageKeys,
  missingGroundingKeysInDatabase,
  missingStorageKeys,
  loadCatalogCorpusRows,
  seedCatalogCorpus,
} from "../../lib/catalog-corpus.mjs";

const { isSafeE2eSeedTarget } = await import("../../../src/lib/e2e-seed-guard.ts");

export async function ensureGroundingCorpus(databaseUrl, log = () => undefined) {
  const expected = expectedGroundingStorageKeys();
  const missingFromCatalog = missingStorageKeys(loadCatalogCorpusRows(), expected);
  if (missingFromCatalog.length > 0) {
    throw new Error(
      `catalog/ is missing grounding fixture storage keys: ${missingFromCatalog.join(", ")}`,
    );
  }

  const target = isSafeE2eSeedTarget(databaseUrl);
  if (target.allowed) {
    await seedCatalogCorpus({ databaseUrl, log });
  }

  const missingFromDb = await missingGroundingKeysInDatabase({ databaseUrl, expected });
  if (missingFromDb.length > 0) {
    throw new Error(
      `sage-grounding needs ProgramDocument rows for ${missingFromDb.join(", ")}. ` +
        (target.allowed
          ? "Seeding from catalog/ did not write them."
          : `DATABASE_URL host "${target.host}" is not local/CI so this suite will not seed it — ` +
            "run `npx tsx scripts/bench/seed-catalog-corpus.mjs` against a migrated local database, " +
            "or point DATABASE_URL at a replica that already has those rows."),
    );
  }
}

export async function run(ctx) {
  const geminiApiKey = ctx.env?.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("sage-grounding requires GEMINI_API_KEY.");
  }

  const databaseUrl = ctx.env?.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("sage-grounding requires DATABASE_URL (hermetic Postgres with the catalog corpus).");
  }

  await ensureGroundingCorpus(databaseUrl, (message) => ctx.log?.(message));

  // Hermetic CI has catalog notes but no document embeddings. Hybrid search
  // that returns [] (no vectors, no FTS hit) does not fall through to keyword
  // scoring, which is how an empty corpus became pass_rate 0. Keyword mode is
  // production's documented kill switch and is enough for citation attachment;
  // rag-retrieval remains the hybrid-quality instrument (prod-readonly).
  const { bucket, caseResults } = await runChatHarnessFamily("grounding", {
    geminiApiKey,
    env: { SAGE_RAG_MODE: "keyword", DATABASE_URL: databaseUrl },
  });
  const { evaluated, passRate } = passRateFromBucket(bucket);

  return {
    metrics: [
      {
        id: "pass_rate",
        value: passRate ?? 0,
        n: evaluated,
        details: { failing: caseResults.filter((r) => r.pass === false).map((r) => ({ id: r.id, reason: r.reason })) },
      },
    ],
  };
}

await maybeRunSelfTest({ suite: "sage-grounding", run, importMeta: import.meta });
