#!/usr/bin/env node
/**
 * Benchmark suite: authenticated axe violations (report only).
 *
 * config/benchmarks/axe-authenticated.json — watch tier, requires
 * browser+server. No floor yet: this is the "33 known violations, soaking"
 * number from e2e/a11y-authenticated.spec.ts, tracked so it can never grow
 * while the burn-down is in progress, per §4.9 of the design.
 *
 * e2e/bench-axe-authenticated.spec.ts (a Playwright spec) does the scan and
 * writes reports/benchmarks/raw/axe-authenticated.json; this module reads it
 * and reports the total, matching the same read-raw-JSON split as
 * touch-targets.mjs.
 *
 * Contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md):
 *   run(ctx) -> { metrics: [{ id, value, n, details }] }
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const RAW_DATA_PATH = join(REPO_ROOT, "reports/benchmarks/raw/axe-authenticated.json");

export async function run(ctx) {
  const rawPath = ctx?.rawDataPath ?? RAW_DATA_PATH;
  let raw;
  try {
    raw = JSON.parse(readFileSync(rawPath, "utf8"));
  } catch {
    return {
      metrics: [
        {
          id: "violations_total",
          value: null,
          n: 0,
          details: {
            skipped: true,
            reason: `no raw data at ${rawPath} — run: npx playwright test e2e/bench-axe-authenticated.spec.ts (needs a running dev server + seeded DB)`,
          },
        },
      ],
    };
  }

  const perRoute = {};
  for (const route of raw.routes) {
    perRoute[`${route.role}:${route.route}`] = {
      violationCount: route.violationCount,
      violations: route.violations,
    };
  }

  return {
    metrics: [
      {
        id: "violations_total",
        value: raw.violationsTotal,
        n: raw.routes.length,
        details: { generatedAt: raw.generatedAt, perRoute },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// --self-test — skips cleanly (exit 0) when the raw browser-walk data is
// absent, per this task's gate: "browser suites skip cleanly here".
// ---------------------------------------------------------------------------
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
  } catch {
    return false;
  }
})();

if (isMainModule && process.argv.includes("--self-test")) {
  run({})
    .then((result) => {
      const metric = result.metrics[0];
      console.log("axe-authenticated --self-test");
      if (metric.details?.skipped) {
        console.log(`  SKIPPED: ${metric.details.reason}`);
        console.log("\n--self-test: SKIP (not a failure — no browser/server available)");
        return;
      }
      console.log(`  violations_total: ${metric.value} (routes scanned=${metric.n})`);
      for (const [route, data] of Object.entries(metric.details.perRoute)) {
        console.log(`    ${route}: ${data.violationCount}`);
      }
      console.log("\n--self-test: PASS");
    })
    .catch((err) => {
      console.error("--self-test: FAIL");
      console.error(err);
      process.exitCode = 1;
    });
}
