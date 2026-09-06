/**
 * Benchmark: rls-coverage. See config/benchmarks/rls-coverage.json for the
 * ratio's definition and scripts/bench/suites/lib/rls-parse.mjs for the full
 * heuristic writeup (policy-table extraction, it()-block extraction, and the
 * positive/negative classification).
 *
 * Self-test:
 *   node --import tsx scripts/bench/suites/rls-coverage.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { extractPolicyBearingTables, extractItBlocks, computeRlsCoverage } from "./lib/rls-parse.mjs";

const RLS_TEST_PATH = "src/lib/rls.test.ts";
const MIGRATIONS_DIR = "prisma/migrations";

export async function run() {
  const policyBearingTables = extractPolicyBearingTables(MIGRATIONS_DIR);
  const testSource = readFileSync(RLS_TEST_PATH, "utf8");
  const itBlocks = extractItBlocks(testSource);

  const result = computeRlsCoverage(policyBearingTables, itBlocks);

  return {
    metrics: [
      {
        id: "coverage_ratio",
        value: result.ratio,
        n: policyBearingTables.length,
        details: {
          policyBearingTableCount: policyBearingTables.length,
          coveredCount: result.coveredTables.length,
          uncoveredTables: result.uncoveredTables,
          itBlockCount: itBlocks.length,
        },
      },
    ],
  };
}

await maybeRunSelfTest({ suite: "rls-coverage", run, importMeta: import.meta });
