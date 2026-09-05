#!/usr/bin/env node
/**
 * The benchmark runner.
 *
 *   npm run bench -- --suite=<name> [--compare] [--json]
 *   npm run bench -- --tier=gate --compare
 *   npm run bench -- --suite=<name> --update-baseline --reason="…"
 *   npm run bench -- --list
 *
 * Loads config/benchmarks/<suite>.json, checks the suite's `requires` against
 * the environment, imports the scorer, hands it `ctx`, writes
 * reports/benchmarks/latest/<suite>.json, and prints a table.
 *
 * Exit codes (contract "CLI"):
 *   0  every suite passed, watched, or was skipped — and every run without
 *      --compare, which measures rather than judges
 *   1  with --compare: a gate- or nightly-tier metric under its floor, or a
 *      suite whose scorer threw
 *   2  a usage or config error (unknown suite/tier, unparseable config,
 *      --update-baseline without --reason)
 *
 * Tier decides the consequence, status decides the meaning: a watch-tier
 * suite records FAIL for a human to read but never fails the run.
 *
 * The npm script runs this under `node --import tsx` so a scorer may import
 * production TypeScript directly (`import { fit } from "../../../src/lib/…"`)
 * instead of copying logic into a fixture.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BENCH_LATEST_DIR,
  BASELINE_PATH,
  TIERS,
  discoverSuites,
  loadBaseline,
  baselineValue,
  validateSuiteConfig,
} from "./lib/discover.mjs";
import { checkRequires, describeUnmet, resolveEnv } from "./lib/env.mjs";
import { describeHost, hostFingerprint, withOllama } from "./lib/host.mjs";
import { buildResult, validateResult } from "./lib/result.mjs";
import { metricStatus } from "./lib/status.mjs";
import { compareResults, formatTable, formatValue } from "./compare.mjs";

const KNOWN_FLAGS = new Set([
  "suite",
  "tier",
  "compare",
  "update-baseline",
  "reason",
  "json",
  "list",
  "help",
]);

const USAGE = `Usage:
  npm run bench -- --suite=<name>[,<name>] [--compare] [--json]
  npm run bench -- --tier=${TIERS.join("|")} [--compare] [--json]
  npm run bench -- --suite=<name> --update-baseline --reason="why this moved"
  npm run bench -- --list`;

/** Parse `--key=value` and bare `--flag`; anything else is a usage error. */
export function parseArgs(argv) {
  const flags = {};
  const unknown = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      unknown.push(arg);
      continue;
    }
    const [, key, value] = match;
    if (!KNOWN_FLAGS.has(key)) {
      unknown.push(arg);
      continue;
    }
    flags[key] = value === undefined ? true : value;
  }
  return { flags, unknown };
}

function repoRootFromEnv(env = process.env) {
  return env.BENCH_REPO_ROOT ? resolve(env.BENCH_REPO_ROOT) : resolve(import.meta.dirname, "..", "..");
}

function currentCommit(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Load a suite's fixture. A non-JSON path (a directory of data, say) is
 * handed to the scorer as `fixturePath` only. */
function loadFixture(repoRoot, fixture) {
  if (typeof fixture !== "string" || fixture.length === 0) {
    return { fixture: null, fixturePath: null };
  }
  const fixturePath = resolve(repoRoot, fixture);
  if (!fixture.endsWith(".json") || !existsSync(fixturePath)) {
    return { fixture: null, fixturePath };
  }
  return { fixture: JSON.parse(readFileSync(fixturePath, "utf8")), fixturePath };
}

/**
 * Run one suite and return its result object.
 *
 * @param {{ config: any, repoRoot: string, baseline: any, host: any, commit: string|null, env: NodeJS.ProcessEnv, out: (line: string) => void }} input
 */
export async function runSuite({ config, repoRoot, baseline, host, commit, env, out }) {
  const startedAt = new Date();
  const started = Date.now();
  const common = {
    suite: config.suite,
    tier: config.tier,
    startedAt: startedAt.toISOString(),
    commit,
    host,
  };

  const requirements = checkRequires(config.requires, env);
  if (!requirements.met) {
    return buildResult({
      ...common,
      durationMs: Date.now() - started,
      metrics: config.metrics.map((metric) => ({
        id: metric.id,
        value: null,
        unit: metric.unit,
        ...(metric.displayUnit !== undefined ? { displayUnit: metric.displayUnit } : {}),
        ...(metric.reason !== undefined ? { reason: metric.reason } : {}),
        ...(metric.direction ? { direction: metric.direction } : {}),
        status: "skipped",
      })),
      status: "skipped",
      skipped: describeUnmet(requirements),
    });
  }

  const scorerPath = resolve(repoRoot, config.scorer);
  let output;
  try {
    const { fixture, fixturePath } = loadFixture(repoRoot, config.fixture);
    const scorer = await import(pathToFileURL(scorerPath).href);
    if (typeof scorer.run !== "function") {
      throw new Error(`${config.scorer} does not export run(ctx)`);
    }
    /**
     * The scorer contract. The first six keys are the shared contract every
     * suite author codes against; `suite`, `config`, `repoRoot`, `commit` and
     * `host` are additive conveniences.
     */
    const ctx = {
      suite: config.suite,
      config,
      fixture,
      fixturePath,
      env: resolveEnv(env),
      log: (...args) => out(`  [${config.suite}] ${args.join(" ")}`),
      now: () => new Date(),
      repoRoot,
      commit,
      host,
    };
    output = await scorer.run(ctx);
    if (!output || !Array.isArray(output.metrics)) {
      throw new Error("run(ctx) must resolve to { metrics: [...] }");
    }
  } catch (error) {
    return buildResult({
      ...common,
      durationMs: Date.now() - started,
      metrics: [],
      status: "error",
      error: error?.stack ? `${error.message}\n${error.stack}` : String(error?.message ?? error),
    });
  }

  const returned = new Map(output.metrics.map((metric) => [metric.id, metric]));
  const missing = config.metrics.filter((metric) => !returned.has(metric.id)).map((m) => m.id);
  const extra = output.metrics
    .map((metric) => metric.id)
    .filter((id) => !config.metrics.some((metric) => metric.id === id));
  for (const id of extra) {
    out(`  [${config.suite}] warning: metric "${id}" is not declared in the config and was dropped`);
  }
  if (missing.length > 0) {
    return buildResult({
      ...common,
      durationMs: Date.now() - started,
      metrics: [],
      status: "error",
      error:
        `the scorer returned no value for declared metric(s): ${missing.join(", ")} — ` +
        "a declared metric that never reports would otherwise pass silently",
    });
  }

  const metrics = config.metrics.map((metric) => {
    const measured = returned.get(metric.id);
    const committed = baselineValue(baseline, config.suite, metric.id);
    return {
      id: metric.id,
      value: measured.value ?? null,
      unit: metric.unit,
      // `displayUnit` and `reason` are the config's words; the runner carries
      // them through untouched for the dashboard and never interprets them.
      ...(metric.displayUnit !== undefined ? { displayUnit: metric.displayUnit } : {}),
      ...(metric.reason !== undefined ? { reason: metric.reason } : {}),
      ...(metric.direction ? { direction: metric.direction } : {}),
      n: measured.n ?? null,
      floor: metric.floor ?? null,
      tolerance: metric.tolerance ?? null,
      ...(metric.exact !== undefined ? { exact: metric.exact } : {}),
      baseline: committed,
      status: metricStatus(metric, measured.value, committed),
      ...(measured.details !== undefined ? { details: measured.details } : {}),
    };
  });

  return buildResult({
    ...common,
    durationMs: Date.now() - started,
    provider: output.provider ?? null,
    model: output.model ?? null,
    metrics,
  });
}

/** Write one result file, refusing to write anything the schema rejects. */
function writeResult(repoRoot, result, out) {
  const errors = validateResult(result);
  if (errors.length > 0) {
    throw new Error(
      `result for "${result.suite}" does not match config/benchmarks/result.schema.json:\n  ` +
        errors.join("\n  ")
    );
  }
  const path = join(resolve(repoRoot, BENCH_LATEST_DIR), `${result.suite}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  out(`  wrote ${join(BENCH_LATEST_DIR, `${result.suite}.json`)}`);
}

/**
 * Rewrite the baseline rows for the suites just measured. Refused without a
 * reason by the caller — the reason is what makes a moved floor auditable.
 */
function updateBaseline({ repoRoot, results, baseline, reason, out }) {
  const next = { ...baseline };
  for (const result of results) {
    if (result.status === "skipped" || result.status === "error") {
      out(`  baseline: skipping ${result.suite} (${result.status})`);
      continue;
    }
    const rows = { ...(next[result.suite] ?? {}) };
    for (const metric of result.metrics) {
      if (metric.value === null) continue;
      rows[metric.id] = {
        value: metric.value,
        commit: result.commit,
        measuredAt: result.startedAt,
        provider: result.provider,
        model: result.model,
        host: hostFingerprint(result.host),
        reason,
      };
    }
    next[result.suite] = rows;
  }
  const path = resolve(repoRoot, BASELINE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sortKeys(next), null, 2)}\n`);
  out(`  wrote ${BASELINE_PATH}`);
}

/** Deterministic key order so a baseline diff shows only what moved. */
function sortKeys(value) {
  if (Array.isArray(value) || typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
}

function printResultsTable(results, out) {
  const rows = [];
  for (const result of results) {
    if (result.metrics.length === 0) {
      rows.push({
        suite: result.suite,
        tier: result.tier,
        metric: "—",
        unit: null,
        value: null,
        baseline: null,
        floor: null,
        status: result.status,
        note: result.error ? result.error.split("\n")[0] : (result.skipped ?? ""),
      });
      continue;
    }
    for (const metric of result.metrics) {
      rows.push({
        suite: result.suite,
        tier: result.tier,
        metric: metric.id,
        unit: metric.unit,
        value: metric.value,
        baseline: metric.baseline ?? null,
        floor: metric.floor ?? null,
        status: metric.status,
        note: result.status === "skipped" ? (result.skipped ?? "") : "",
      });
    }
  }
  out(formatTable(rows));
}

async function main() {
  const { flags, unknown } = parseArgs(process.argv.slice(2));
  const jsonMode = flags.json === true;
  // With --json, stdout carries only JSON; everything human goes to stderr.
  const out = (line) => (jsonMode ? console.error(line) : console.log(line));

  if (flags.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (unknown.length > 0) {
    console.error(`bench: unknown argument(s): ${unknown.join(", ")}\n${USAGE}`);
    process.exit(2);
  }

  const repoRoot = repoRootFromEnv();
  const { suites, errors } = discoverSuites({ repoRoot });
  if (errors.length > 0) {
    console.error("bench: benchmark configuration errors:");
    for (const error of errors) console.error(`  ${error}`);
    process.exit(2);
  }

  if (flags.list === true) {
    const rows = suites.map((suite) => {
      const check = checkRequires(suite.config.requires, process.env);
      return [
        suite.config.suite,
        suite.config.tier ?? "—",
        (suite.config.requires ?? []).join(",") || "—",
        check.met ? "ready" : "skipped",
        suite.config.title ?? "",
      ];
    });
    const headers = ["SUITE", "TIER", "REQUIRES", "STATE", "TITLE"];
    const widths = headers.map((header, index) =>
      Math.max(header.length, ...rows.map((cells) => cells[index].length))
    );
    const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
    console.log(line(headers));
    console.log(line(widths.map((width) => "-".repeat(width))));
    for (const row of rows) console.log(line(row));
    process.exit(0);
  }

  // --- selection ---------------------------------------------------------
  let selected;
  if (typeof flags.suite === "string") {
    const names = flags.suite.split(",").map((name) => name.trim()).filter(Boolean);
    selected = [];
    for (const name of names) {
      const match = suites.find((suite) => suite.config.suite === name);
      if (!match) {
        console.error(
          `bench: no suite named "${name}" — expected config/benchmarks/${name}.json ` +
            "(run with --list to see what exists)"
        );
        process.exit(2);
      }
      selected.push(match);
    }
  } else if (typeof flags.tier === "string") {
    if (!TIERS.includes(flags.tier)) {
      console.error(`bench: unknown tier "${flags.tier}" (expected ${TIERS.join(", ")})`);
      process.exit(2);
    }
    selected = suites.filter((suite) => suite.config.tier === flags.tier);
  } else {
    console.error(`bench: pass --suite=<name> or --tier=<tier>.\n${USAGE}`);
    process.exit(2);
  }

  if (flags["update-baseline"] === true && typeof flags.reason !== "string") {
    console.error(
      "bench: --update-baseline needs --reason=\"…\". A baseline that moves without a recorded " +
        "reason is how a floor quietly stops meaning anything (design §6)."
    );
    process.exit(2);
  }

  let baseline;
  try {
    baseline = loadBaseline(repoRoot);
  } catch (error) {
    console.error(`bench: ${error.message}`);
    process.exit(2);
  }

  // --- per-suite config validation ---------------------------------------
  const configErrors = [];
  for (const suite of selected) {
    const { errors: suiteErrors } = validateSuiteConfig(suite.config, {
      path: suite.path,
      repoRoot,
      baseline,
    });
    for (const error of suiteErrors) configErrors.push(`${suite.path}: ${error}`);
  }
  if (configErrors.length > 0) {
    console.error("bench: benchmark configuration errors:");
    for (const error of configErrors) console.error(`  ${error}`);
    console.error("  (npm run bench:validate lists every suite's problems at once)");
    process.exit(2);
  }

  if (selected.length === 0) {
    out(`bench: no suites matched ${flags.tier ? `tier "${flags.tier}"` : "the selection"}.`);
    if (jsonMode) console.log("[]");
    process.exit(0);
  }

  // --- run ---------------------------------------------------------------
  const env = resolveEnv(process.env);
  const host = await withOllama(describeHost(), env.ollamaHost);
  const commit = currentCommit(repoRoot);

  const results = [];
  for (const suite of selected) {
    out(`bench: ${suite.config.suite} (${suite.config.tier})`);
    const result = await runSuite({
      config: suite.config,
      repoRoot,
      baseline,
      host,
      commit,
      env: process.env,
      out,
    });
    try {
      writeResult(repoRoot, result, out);
    } catch (error) {
      console.error(`bench: ${error.message}`);
      process.exit(2);
    }
    results.push(result);
  }

  out("");
  printResultsTable(results, out);

  if (flags["update-baseline"] === true) {
    updateBaseline({ repoRoot, results, baseline, reason: flags.reason, out });
  }

  if (jsonMode) console.log(JSON.stringify(results, null, 2));

  if (flags.compare !== true) process.exit(0);

  const { failures } = compareResults({ results, baseline });
  if (failures.length > 0) {
    out("");
    for (const failure of failures) {
      out(
        `FAIL ${failure.suite}.${failure.metric} (${failure.tier}) — ` +
          `${formatValue(failure.value, failure.unit)} against floor ` +
          `${formatValue(failure.floor, failure.unit)}` +
          (failure.note ? ` — ${failure.note}` : "")
      );
    }
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
