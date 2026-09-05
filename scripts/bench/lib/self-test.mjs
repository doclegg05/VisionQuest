// =============================================================================
// `--self-test` for a suite scorer.
//
// The plan's contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md)
// says every scorer must run standalone before the runner lands:
//
//   node scripts/bench/suites/<suite>.mjs --self-test
//
// This is that entry point, factored out so eight scorers do not each grow
// their own argv parsing and their own idea of what an exit code means.
//
// It deliberately does NOT apply floors. A self-test answers "does this scorer
// execute and produce metrics", which is a different question from "is the
// number good enough" — that one belongs to the runner's `--compare`, reading
// the floors out of the suite config. A self-test that failed on a floor would
// make every scorer a second, divergent copy of the comparison logic.
//
// What it DOES check is that the scorer's output matches the config it claims:
// every metric the config declares is present, and no metric is reported that
// the config never declared. That catches the failure this contract is most
// exposed to — a scorer and its config drifting apart while both look fine on
// their own.
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");

export function benchRepoRoot() {
  return REPO;
}

/** Read `config/benchmarks/<suite>.json`. */
export function loadSuiteConfig(suite) {
  return JSON.parse(
    readFileSync(path.join(REPO, "config", "benchmarks", `${suite}.json`), "utf8"),
  );
}

/**
 * The `ctx` the plan's contract hands a scorer.
 *
 * `fixture` is the parsed fixture file when the config names one, and null when
 * it does not — several Connect suites derive everything from the synthetic
 * cohort and have no separate corpus.
 */
export function buildContext(config, { log = console.log } = {}) {
  let fixture = null;
  let fixturePath = null;
  if (config.fixture) {
    fixturePath = path.join(REPO, config.fixture);
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  }

  return {
    fixture,
    fixturePath,
    env: {
      databaseUrl: process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || null,
      geminiApiKey: process.env.GEMINI_API_KEY || null,
      ollamaHost: process.env.OLLAMA_HOST || null,
      baseUrl: process.env.BENCH_BASE_URL || process.env.BASE_URL || null,
    },
    log,
    now: () => new Date(),
  };
}

/**
 * Run one scorer against its own config and print the metrics.
 *
 * Exits 1 on a thrown error (the contract's requirement) and on a config/metric
 * mismatch. A scorer that legitimately cannot run — `requires` unmet — returns
 * `{ skipped: "…" }`, which prints and exits 0: an unmet requirement is not a
 * failure, and treating it as one would make the e2e and Gemini suites red on
 * every developer machine.
 */
export async function selfTest(suite, run) {
  const config = loadSuiteConfig(suite);
  const started = Date.now();

  let result;
  try {
    result = await run(buildContext(config));
  } catch (error) {
    console.error(`${suite}: FAILED — ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  }

  if (result?.skipped) {
    console.log(`${suite}: skipped — ${result.skipped}`);
    return;
  }

  const metrics = result?.metrics ?? [];
  const declared = new Set((config.metrics ?? []).map((metric) => metric.id));
  const reported = new Set(metrics.map((metric) => metric.id));

  const problems = [];
  for (const id of declared) {
    if (!reported.has(id)) problems.push(`config declares "${id}" but the scorer did not report it`);
  }
  for (const id of reported) {
    if (!declared.has(id)) problems.push(`the scorer reported "${id}" but the config does not declare it`);
  }

  for (const metric of metrics) {
    const spec = (config.metrics ?? []).find((entry) => entry.id === metric.id);
    const floor = spec?.floor;
    const direction = spec?.direction ?? "higher";
    const verdict =
      floor === undefined
        ? "info"
        : (direction === "lower" ? metric.value <= floor : metric.value >= floor)
          ? "meets floor"
          : "BELOW FLOOR";
    console.log(
      `${suite}.${metric.id} = ${metric.value}` +
        (metric.n === undefined ? "" : ` (n=${metric.n})`) +
        (floor === undefined ? "" : ` [floor ${floor}]`) +
        ` — ${verdict}`,
    );
    if (metric.details && process.env.BENCH_VERBOSE) {
      console.log(`  ${JSON.stringify(metric.details)}`);
    }
  }

  console.log(`${suite}: ${metrics.length} metric(s) in ${Date.now() - started} ms`);

  if (problems.length > 0) {
    console.error(`${suite}: config/scorer mismatch\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
}

/** True when this module's importer was run directly with `--self-test`. */
export function isSelfTest(importMetaUrl) {
  return (
    importMetaUrl === `file://${process.argv[1]}` && process.argv.includes("--self-test")
  );
}
