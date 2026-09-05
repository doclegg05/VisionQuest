/**
 * Shared `--self-test` bootstrap for A1's benchmark suites.
 *
 * Owned by scripts/bench/suites/lib/ (not scripts/bench/lib/ — that path is
 * A0's runner). This is a standalone helper: it does NOT depend on the
 * runner landing, so every suite here can be exercised with
 * `node --import tsx scripts/bench/suites/<name>.mjs --self-test` before
 * scripts/bench/run.mjs exists. Once A0's runner lands, ctx shape here
 * should already match the contract in
 * docs/superpowers/plans/2026-09-05-benchmark-suite.md, so no suite code
 * should need to change — only this bootstrap gets superseded by run.mjs.
 *
 * Contract (from the plan): `--self-test` executes `run(ctx)` against the
 * fixture and prints the metrics; exits 1 on a THROWN error only. Per this
 * task's gate list, a suite whose `requires` are unmet must skip cleanly
 * (exit 0, explanatory message) rather than throw or fail.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * requirement id -> { met(): boolean, reason(): string }
 * Vocabulary and env var names come from the plan's contract section
 * ("The runner checks env ... and marks a suite skipped when unmet").
 */
const REQUIREMENT_CHECKS = {
  postgres: {
    met: () => Boolean(process.env.DATABASE_URL),
    reason: () => "DATABASE_URL is not set",
  },
  gemini: {
    met: () => Boolean(process.env.GEMINI_API_KEY),
    reason: () => "GEMINI_API_KEY is not set",
  },
  ollama: {
    met: () => Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_URL),
    reason: () => "OLLAMA_HOST (or OLLAMA_URL) is not set",
  },
  browser: {
    met: () => Boolean(process.env.PLAYWRIGHT),
    reason: () => "PLAYWRIGHT is not set",
  },
  "prod-readonly": {
    met: () => Boolean(process.env.BENCH_PROD_READONLY_URL),
    reason: () => "BENCH_PROD_READONLY_URL is not set (owner step — a read-only prod replica URL)",
  },
  server: {
    met: () => Boolean(process.env.BENCH_BASE_URL),
    reason: () => "BENCH_BASE_URL is not set",
  },
  cohort: {
    met: () => {
      const dir = "config/benchmarks/synthetic-cohort";
      return existsSync(dir) && readdirSync(dir).length > 0;
    },
    reason: () => "config/benchmarks/synthetic-cohort/ does not exist or is empty (A3's seeded cohort)",
  },
};

function checkRequirements(requires) {
  const unmet = [];
  for (const req of requires ?? []) {
    const check = REQUIREMENT_CHECKS[req];
    if (!check) {
      unmet.push(`unknown requirement "${req}"`);
      continue;
    }
    if (!check.met()) unmet.push(check.reason());
  }
  return unmet;
}

function buildEnv() {
  return {
    databaseUrl: process.env.DATABASE_URL || null,
    geminiApiKey: process.env.GEMINI_API_KEY || null,
    ollamaHost: process.env.OLLAMA_HOST || process.env.OLLAMA_URL || null,
    baseUrl: process.env.BENCH_BASE_URL || null,
    prodReadonlyUrl: process.env.BENCH_PROD_READONLY_URL || null,
  };
}

function formatMetric(metric, configMetric) {
  const parts = [`  ${metric.id}: ${metric.value}`];
  if (metric.unit) parts.push(`(${metric.unit})`);
  if (metric.n !== undefined && metric.n !== null) parts.push(`n=${metric.n}`);
  // "floor": null (with a "reason") is the deliberate, documented opt-out of
  // gating — matches scripts/bench/lib/discover.mjs's contract. Only a real
  // finite number is a floor to compare against; null must read as info,
  // never coerce to 0 and report a false BREACH.
  const hasFloor = typeof configMetric?.floor === "number" && Number.isFinite(configMetric.floor);
  if (hasFloor) {
    const dir = configMetric.direction === "lower" ? "<=" : ">=";
    const ok =
      configMetric.direction === "lower" ? metric.value <= configMetric.floor : metric.value >= configMetric.floor;
    parts.push(`floor ${dir} ${configMetric.floor} [${ok ? "OK" : "BREACH"}]`);
  } else {
    parts.push(configMetric?.reason ? `(info: ${configMetric.reason})` : "(info, no floor)");
  }
  return parts.join(" ");
}

/**
 * @param {object} opts
 * @param {string} opts.suite - suite name, matching config/benchmarks/<suite>.json
 * @param {(ctx: object) => Promise<{metrics: Array}>} opts.run
 * @param {string} [opts.configPath] - override the config path (defaults to config/benchmarks/<suite>.json)
 * @param {ImportMeta} opts.importMeta - pass `import.meta` from the calling suite
 * @param {string[]} [opts.argv] - defaults to process.argv.slice(2)
 */
export async function maybeRunSelfTest({ suite, run, configPath, importMeta, argv = process.argv.slice(2) }) {
  const invokedDirectly = process.argv[1] === fileURLToPath(importMeta.url);
  if (!invokedDirectly || !argv.includes("--self-test")) return;

  const resolvedConfigPath = configPath || `config/benchmarks/${suite}.json`;
  const config = JSON.parse(readFileSync(resolvedConfigPath, "utf8"));

  const unmet = checkRequirements(config.requires);
  if (unmet.length > 0) {
    console.log(`SKIP ${suite}: requirement(s) not met — ${unmet.join("; ")}`);
    process.exitCode = 0;
    return;
  }

  const fixturePath = config.fixture || null;
  const fixture = fixturePath && existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;

  const ctx = {
    fixture,
    fixturePath,
    env: buildEnv(),
    log: (...args2) => console.log(`[${suite}]`, ...args2),
    now: () => Date.now(),
  };

  const metricsById = new Map((config.metrics ?? []).map((m) => [m.id, m]));

  const startedAt = Date.now();
  let result;
  try {
    result = await run(ctx);
  } catch (error) {
    console.error(`FAIL ${suite}: run(ctx) threw —`, error);
    process.exitCode = 1;
    return;
  }
  const durationMs = Date.now() - startedAt;

  console.log(`\n${suite} — self-test (${durationMs}ms)`);
  for (const metric of result.metrics ?? []) {
    console.log(formatMetric(metric, metricsById.get(metric.id)));
    if (metric.details && process.env.BENCH_SELF_TEST_VERBOSE) {
      console.log(`    details: ${JSON.stringify(metric.details)}`);
    }
  }
  process.exitCode = 0;
}
