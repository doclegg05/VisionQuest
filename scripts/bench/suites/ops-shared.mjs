/**
 * Shared helpers for the A7 ops/cost/model-benchmark suites
 * (cron-health, cost-per-student, ferpa-routing, model-bakeoff, backup-drill,
 * scheduled-layer-drift). Not part of the runner contract itself — the
 * runner (`scripts/bench/run.mjs`, Phase 0) is what actually builds `ctx` and
 * calls each suite's `run(ctx)` in production. This module exists so each of
 * these six suite files can be exercised standalone via
 * `node --import tsx scripts/bench/suites/<suite>.mjs --self-test` before
 * that runner lands, per the plan's "every other phase writes suites that
 * conform to the contract and can be exercised standalone" rule
 * (docs/superpowers/plans/2026-09-05-benchmark-suite.md).
 *
 * `buildSelfTestCtx` reconstructs the same `ctx` shape the contract
 * documents (`{ fixture, fixturePath, env, log, now }`), reading the same
 * env vars the real runner will (`BENCH_PROD_READONLY_URL` falling back to
 * `CRON_CHECK_DATABASE_URL` for the two prod-readonly suites that document
 * that fallback, `GEMINI_API_KEY`, `OLLAMA_HOST`/`OLLAMA_URL`,
 * `BENCH_BASE_URL`), so a suite exercised this way behaves the same under
 * the real runner once it exists.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Read and JSON.parse a path relative to the repo root. */
export function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

/** True while this module is the entry point of the current process. */
export function isMainModule(moduleUrl) {
  return Boolean(process.argv[1]) && moduleUrl === `file://${process.argv[1]}`;
}

/**
 * The runner's documented env → ctx.env mapping (§3 "Suite config" in the
 * plan). `databaseUrl` accepts `CRON_CHECK_DATABASE_URL` as a fallback
 * because the cron-health suite's contract entry says to: the same
 * postgres-role connection string the existing cron-health.yml nightly
 * workflow already uses as a repo secret, so a project that already set
 * that secret does not need a second one for this suite.
 */
export function buildSelfTestCtx(fixture, fixturePath) {
  return {
    fixture,
    fixturePath,
    env: {
      databaseUrl: process.env.BENCH_PROD_READONLY_URL || process.env.CRON_CHECK_DATABASE_URL || null,
      geminiApiKey: process.env.GEMINI_API_KEY || null,
      ollamaHost: process.env.OLLAMA_HOST || process.env.OLLAMA_URL || null,
      baseUrl: process.env.BENCH_BASE_URL || null,
    },
    log: (...args) => console.log(...args),
    now: () => new Date(),
  };
}

/**
 * Runs one suite's `run(ctx)` the way `--self-test` is specified to:
 * against its own fixture, printing metrics, exiting 1 on a thrown error.
 *
 * `checkRequires(ctx)` mirrors the runner's env-gating (§3: "The runner
 * checks env ... and marks a suite skipped when unmet") for suites whose
 * `requires` cannot be satisfied in this environment — a standalone
 * self-test has no runner to do that gating for it, so each suite here
 * reproduces its own check and reports a clean skip (exit 0) rather than
 * failing the gate for missing prod/Ollama credentials, per "prod ones skip
 * cleanly" in this agent's brief.
 *
 * @param {object} args
 * @param {string} args.suiteName
 * @param {string} args.configPath suite config JSON, relative to repo root
 * @param {(ctx: object) => Promise<{ metrics: Array<object> }>} args.run
 * @param {(ctx: object) => string | null | Promise<string | null>} [args.checkRequires] returns a skip reason, or null when requirements are met — may be async (e.g. pinging a live Ollama server)
 * @returns {Promise<number>} process exit code
 */
export async function runSelfTest({ suiteName, configPath, run, checkRequires }) {
  const config = readJson(configPath);
  const fixture = readJson(config.fixture);
  const ctx = buildSelfTestCtx(fixture, config.fixture);

  const skipReason = checkRequires ? await checkRequires(ctx) : null;
  if (skipReason) {
    console.log(`[${suiteName}] SKIPPED (requires unmet): ${skipReason}`);
    return 0;
  }

  try {
    const result = await run(ctx);
    console.log(`[${suiteName}] metrics:`);
    for (const metric of result.metrics ?? []) {
      const n = metric.n !== undefined ? ` (n=${metric.n})` : "";
      console.log(`  ${metric.id} = ${JSON.stringify(metric.value)}${n}`);
    }
    return 0;
  } catch (error) {
    console.error(`[${suiteName}] FAILED: ${error?.stack ?? error}`);
    return 1;
  }
}
