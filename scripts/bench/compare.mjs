#!/usr/bin/env node
/**
 * Compare the latest benchmark results against the committed baseline.
 *
 *   node scripts/bench/compare.mjs            # npm run bench:compare
 *   npm run bench -- --tier=gate --compare    # same function, inline
 *
 * Reads every reports/benchmarks/latest/<suite>.json and
 * reports/benchmarks/baseline.json, re-derives each metric's status from the
 * baseline on disk (so bumping a baseline changes the verdict without
 * re-running a suite), prints one table, and exits 1 when a gate- or
 * nightly-tier metric failed.
 *
 * Tier decides the consequence, status decides the meaning: a `watch`-tier
 * suite can print FAIL — that is the point of the tier — without failing the
 * run (design §3, "watch (reports, never fails)").
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { BENCH_LATEST_DIR, loadBaseline, baselineValue } from "./lib/discover.mjs";
import { metricStatus } from "./lib/status.mjs";

/** Tiers whose failures stop a run. */
export const BLOCKING_TIERS = Object.freeze(["gate", "nightly"]);

export function repoRootFromEnv(env = process.env) {
  return env.BENCH_REPO_ROOT ? resolve(env.BENCH_REPO_ROOT) : resolve(import.meta.dirname, "..", "..");
}

/**
 * Read every result file in reports/benchmarks/latest/.
 * @param {string} repoRoot
 */
export function loadLatestResults(repoRoot) {
  const dir = resolve(repoRoot, BENCH_LATEST_DIR);
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const results = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      results.push(JSON.parse(readFileSync(join(dir, name), "utf8")));
    } catch (error) {
      throw new Error(`${join(BENCH_LATEST_DIR, name)} is not valid JSON: ${error.message}`);
    }
  }
  return results;
}

/**
 * One row per metric (plus one row per skipped/errored suite, which has no
 * metrics to speak for it).
 *
 * @param {{ results: any[], baseline: Record<string, any> }} input
 */
export function compareResults({ results, baseline }) {
  const rows = [];

  for (const result of results) {
    if (result.status === "error" || result.status === "skipped") {
      rows.push({
        suite: result.suite,
        tier: result.tier,
        metric: "—",
        unit: null,
        value: null,
        baseline: null,
        floor: null,
        status: result.status,
        note: result.error ?? result.skipped ?? "",
      });
      if (result.metrics?.length === 0) continue;
    }

    for (const metric of result.metrics ?? []) {
      const committed = baselineValue(baseline, result.suite, metric.id);
      const status =
        result.status === "skipped" || metric.status === "skipped"
          ? "skipped"
          : metricStatus(
              {
                direction: metric.direction,
                floor: metric.floor ?? undefined,
                tolerance: metric.tolerance ?? undefined,
                exact: metric.exact,
              },
              metric.value,
              committed
            );
      rows.push({
        suite: result.suite,
        tier: result.tier,
        metric: metric.id,
        unit: metric.unit,
        value: metric.value,
        baseline: committed,
        floor: metric.floor ?? null,
        status,
        note: "",
      });
    }
  }

  const failures = rows.filter(
    (row) => BLOCKING_TIERS.includes(row.tier) && (row.status === "fail" || row.status === "error")
  );
  return { rows, failures };
}

/** Format a measured value for the table, by unit. */
export function formatValue(value, unit) {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  switch (unit) {
    case "ratio":
      return value.toFixed(3);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "ms":
      return `${Math.round(value)}ms`;
    case "seconds":
      return `${value.toFixed(1)}s`;
    case "grade":
      return value.toFixed(1);
    default:
      return String(value);
  }
}

const HEADERS = ["SUITE", "TIER", "METRIC", "VALUE", "BASELINE", "FLOOR", "STATUS"];

/** Render the comparison rows as a fixed-width table. */
export function formatTable(rows) {
  if (rows.length === 0) return "No benchmark results in reports/benchmarks/latest/.";
  const body = rows.map((row) => [
    row.suite,
    row.tier,
    row.metric,
    formatValue(row.value, row.unit),
    formatValue(row.baseline, row.unit),
    formatValue(row.floor, row.unit),
    row.status.toUpperCase() + (row.note ? ` — ${row.note}` : ""),
  ]);
  const widths = HEADERS.map((header, index) =>
    Math.max(header.length, ...body.map((cells) => cells[index].length))
  );
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
  return [line(HEADERS), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join("\n");
}

async function main() {
  const repoRoot = repoRootFromEnv();
  let results;
  let baseline;
  try {
    results = loadLatestResults(repoRoot);
    baseline = loadBaseline(repoRoot);
  } catch (error) {
    console.error(`bench:compare: ${error.message}`);
    process.exit(2);
  }

  const { rows, failures } = compareResults({ results, baseline });
  console.log(formatTable(rows));

  if (failures.length > 0) {
    console.log("");
    for (const failure of failures) {
      console.log(
        `FAIL ${failure.suite}.${failure.metric} (${failure.tier}) — ` +
          `${formatValue(failure.value, failure.unit)} against floor ${formatValue(failure.floor, failure.unit)}` +
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
