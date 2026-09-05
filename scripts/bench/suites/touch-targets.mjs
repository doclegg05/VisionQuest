#!/usr/bin/env node
/**
 * Benchmark suite: touch targets at 375px (student routes).
 *
 * config/benchmarks/touch-targets.json — watch tier (see that file's `notes`
 * for why: undersized_targets could not be measured in the authoring
 * sandbox, which has no dev server or DATABASE_URL), requires
 * browser+server.
 *
 * This scorer does no browsing itself — e2e/bench-touch-targets.spec.ts
 * (a Playwright spec) does the walk and writes the raw bounding-box data to
 * reports/benchmarks/raw/touch-targets.json; this module just reads that
 * file and applies the floor, per the contract's separation between the
 * suite config/scorer (deterministic, importable) and a browser-backed data
 * collector.
 *
 * Contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md):
 *   run(ctx) -> { metrics: [{ id, value, n, details }] }
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const RAW_DATA_PATH = join(REPO_ROOT, "reports/benchmarks/raw/touch-targets.json");

export async function run(ctx) {
  const rawPath = ctx?.rawDataPath ?? RAW_DATA_PATH;
  let raw;
  try {
    raw = JSON.parse(readFileSync(rawPath, "utf8"));
  } catch {
    // No raw data yet — the browser+server walk (e2e/bench-touch-targets.spec.ts)
    // has not run in this environment. The runner is expected to have already
    // checked `requires: ["browser", "server"]` before calling run() at all;
    // this is the standalone/--self-test fallback for when it hasn't.
    return {
      metrics: [
        {
          id: "undersized_targets",
          value: null,
          n: 0,
          details: {
            skipped: true,
            reason: `no raw data at ${rawPath} — run: npx playwright test e2e/bench-touch-targets.spec.ts (needs a running dev server + seeded DB)`,
          },
        },
      ],
    };
  }

  return {
    metrics: [
      {
        id: "undersized_targets",
        value: raw.undersized.length,
        n: raw.totalInteractive,
        details: {
          generatedAt: raw.generatedAt,
          totalExcluded: raw.totalExcluded,
          violations: raw.undersized,
        },
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
      console.log("touch-targets --self-test");
      if (metric.details?.skipped) {
        console.log(`  SKIPPED: ${metric.details.reason}`);
        console.log("\n--self-test: SKIP (not a failure — no browser/server available)");
        return;
      }
      console.log(`  undersized_targets: ${metric.value} (n=${metric.n})`);
      if (metric.value > 0) {
        console.log("\nUndersized targets:");
        for (const v of metric.details.violations) {
          console.log(`  ${v.route}  ${v.selector}  ${v.width}x${v.height}px  "${v.label}"`);
        }
      }
      console.log("\n--self-test: PASS");
    })
    .catch((err) => {
      console.error("--self-test: FAIL");
      console.error(err);
      process.exitCode = 1;
    });
}
