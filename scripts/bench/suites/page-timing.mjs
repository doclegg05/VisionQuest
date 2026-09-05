#!/usr/bin/env node
/**
 * Benchmark suite: page timing at 375px (design §4.7 "Page timing";
 * config/benchmarks/page-timing.json).
 *
 * Same split as scripts/bench/suites/touch-targets.mjs: e2e/bench-page-timing
 * .spec.ts (a Playwright spec) does the browsing and writes raw navigation
 * samples to reports/benchmarks/raw/page-timing.json; this module only reads
 * that file, takes a p95 per route over its REPEATS samples, and applies the
 * floor.
 *
 * Contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md):
 *   run(ctx) -> { metrics: [{ id, value, n, details }] }
 *
 * TIER IS WATCH (design §4.7: "watch → gate"), for the same reason
 * touch-targets shipped at watch: this worktree has no dev server or
 * DATABASE_URL to run the collector against, so today's real numbers are
 * unknown here. Promote per route once a CI run establishes them.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { percentile } from "../../lib/percentile.mjs";
import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const RAW_DATA_PATH = join(REPO_ROOT, "reports/benchmarks/raw/page-timing.json");
const COLLECTOR_SPEC = "e2e/bench-page-timing.spec.ts";

/** Route ids the collector spec walks; must match e2e/bench-page-timing.spec.ts's ROUTES ids. */
export const ROUTE_IDS = Object.freeze(["dashboard", "career", "teacher", "teacher_connect"]);

/** Pure p95 over one route's raw samples — unit-testable without a browser. */
export function summarizeRouteSamples(samples) {
  const ttfb = samples.map((s) => s.ttfbMs).sort((a, b) => a - b);
  const dcl = samples.map((s) => s.dclMs).sort((a, b) => a - b);
  return {
    n: samples.length,
    p95TtfbMs: percentile(ttfb, 95) ?? 0,
    p95DclMs: percentile(dcl, 95) ?? 0,
  };
}

function skipMetrics(reason) {
  const metrics = [];
  for (const id of ROUTE_IDS) {
    metrics.push({ id: `p95_ttfb_ms_${id}`, value: null, n: 0, details: { skipped: true, reason } });
    metrics.push({ id: `p95_dcl_ms_${id}`, value: null, n: 0, details: { skipped: true, reason } });
  }
  return metrics;
}

export async function run(ctx) {
  const rawPath = ctx?.rawDataPath ?? RAW_DATA_PATH;
  const requirementsMet = Boolean(ctx?.env?.playwright) && Boolean(ctx?.env?.baseUrl);

  let raw;
  try {
    raw = JSON.parse(readFileSync(rawPath, "utf8"));
  } catch (err) {
    if (!requirementsMet) {
      // browser+server genuinely unavailable — this is a skip, not a failure.
      return {
        metrics: skipMetrics(
          `no raw data at ${rawPath} — run: npx playwright test ${COLLECTOR_SPEC} (needs a running dev server + seeded cohort)`,
        ),
      };
    }
    // browser+server ARE available but the raw file is missing — the
    // collector should have run and didn't. That is a suite error.
    throw new Error(
      `page-timing: browser+server are available but no raw data at ${rawPath}. ` +
        `Run the collector first: npx playwright test ${COLLECTOR_SPEC}`,
      { cause: err },
    );
  }

  const metrics = [];
  for (const id of ROUTE_IDS) {
    const entry = raw.byRoute?.[id];
    if (!entry || entry.samples.length === 0) {
      metrics.push({
        id: `p95_ttfb_ms_${id}`,
        value: null,
        n: 0,
        details: { skipped: true, reason: `no samples recorded for route "${id}"`, failures: entry?.failures ?? null },
      });
      metrics.push({
        id: `p95_dcl_ms_${id}`,
        value: null,
        n: 0,
        details: { skipped: true, reason: `no samples recorded for route "${id}"`, failures: entry?.failures ?? null },
      });
      continue;
    }
    const summary = summarizeRouteSamples(entry.samples);
    metrics.push({
      id: `p95_ttfb_ms_${id}`,
      value: Math.round(summary.p95TtfbMs),
      n: summary.n,
      details: { route: entry.route, generatedAt: raw.generatedAt, failures: entry.failures },
    });
    metrics.push({
      id: `p95_dcl_ms_${id}`,
      value: Math.round(summary.p95DclMs),
      n: summary.n,
      details: { route: entry.route, generatedAt: raw.generatedAt, failures: entry.failures },
    });
  }

  return { metrics };
}

await selfTest(import.meta.url, run);
