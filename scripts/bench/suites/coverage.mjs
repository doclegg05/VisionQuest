/**
 * Benchmark: coverage (include-all line coverage). See
 * config/benchmarks/coverage.json for the technique and why it's needed.
 *
 * Runs the REAL test suite (src/**\/*.test.ts(x)) plus a synthetic
 * import-everything test, in one `tsx --test --experimental-test-coverage`
 * invocation, then parses the lcov output.
 *
 * This is the slowest suite in this promotion (it runs the whole unit
 * suite) — expect several minutes.
 *
 * Self-test:
 *   node --import tsx scripts/bench/suites/coverage.mjs --self-test
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { listEligibleSourceFiles } from "./lib/source-files.mjs";
import { writeImportAllTestFile } from "./lib/generate-import-all.mjs";
import { parseLcov } from "./lib/lcov.mjs";
import { aggregateCoverage } from "./lib/coverage-aggregate.mjs";

const execFileAsync = promisify(execFile);

const REAL_TEST_GLOBS = ["src/**/*.test.ts", "src/**/*.test.tsx"];

export async function run(ctx) {
  const eligibleFiles = listEligibleSourceFiles("src");

  const dir = mkdtempSync(join(tmpdir(), "vq-bench-coverage-"));
  const generatedTestFile = join(dir, "import-all.test.mjs");
  const failuresOut = join(dir, "import-failures.json");
  const lcovOut = join(dir, "coverage.lcov");

  try {
    writeImportAllTestFile(eligibleFiles, generatedTestFile, failuresOut);

    ctx.log?.(`running full test suite + ${eligibleFiles.length} forced imports for include-all coverage…`);
    try {
      await execFileAsync(
        "npx",
        [
          "tsx",
          "--test",
          "--experimental-test-coverage",
          "--experimental-test-module-mocks",
          "--test-force-exit",
          `--test-reporter=lcov`,
          `--test-reporter-destination=${lcovOut}`,
          ...REAL_TEST_GLOBS,
          generatedTestFile,
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          timeout: 9 * 60 * 1000,
          maxBuffer: 1024 * 1024 * 256,
        },
      );
    } catch (error) {
      // The real suite has known-failing cases (see .claude/MEMORY.md's
      // "13 known post-response logger failures" note) — a non-zero exit
      // from the combined run is expected, NOT a reason to discard the
      // coverage data it still wrote. Only a missing lcov file is fatal.
      if (!existsSync(lcovOut)) {
        throw new Error(`coverage run produced no lcov output: ${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      }
    }

    const lcovText = readFileSync(lcovOut, "utf8");
    const lcovRecords = parseLcov(lcovText);
    const importFailures = existsSync(failuresOut) ? JSON.parse(readFileSync(failuresOut, "utf8")) : [];

    const agg = aggregateCoverage(eligibleFiles, lcovRecords);

    return {
      metrics: [
        {
          id: "line_coverage",
          value: agg.coverageRatio,
          n: agg.totalLinesFound,
          details: {
            eligibleFileCount: agg.eligibleFileCount,
            reportedFileCount: agg.reportedFileCount,
            totalLinesFound: agg.totalLinesFound,
            totalLinesHit: agg.totalLinesHit,
            importFailureCount: importFailures.length,
          },
        },
        {
          id: "untested_modules",
          value: agg.untestedModules.length,
          n: agg.eligibleFileCount,
          details: {
            untestedModules: agg.untestedModules,
            importFailures,
          },
        },
      ],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await maybeRunSelfTest({ suite: "coverage", run, importMeta: import.meta });
