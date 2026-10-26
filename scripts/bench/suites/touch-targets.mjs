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
 *
 * `details` is committed (reports/benchmarks/latest/*.json) — never student
 * data. Each violation therefore carries only `route`, `selector`, `width`,
 * `height`; a page-text/aria-label `label` field is deliberately dropped
 * here even though the raw collector file records it (security review,
 * 2026-09-05) — see touch-targets.test.mjs for the pinning test.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const RAW_DATA_PATH = join(REPO_ROOT, "reports/benchmarks/raw/touch-targets.json");
const COLLECTOR_SPEC = "e2e/bench-touch-targets.spec.ts";

/** Strip anything but route/selector/width/height before committing a violation. */
function sanitizeViolation(v) {
  return { route: v.route, selector: v.selector, width: v.width, height: v.height };
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
        metrics: [
          {
            id: "undersized_targets",
            value: null,
            n: 0,
            details: {
              skipped: true,
              reason: `no raw data at ${rawPath} — run: npx playwright test ${COLLECTOR_SPEC} (needs a running dev server + seeded DB)`,
            },
          },
        ],
      };
    }
    // browser+server ARE available (PLAYWRIGHT + BENCH_BASE_URL set) but the
    // raw file is missing — the collector spec should have run and didn't.
    // That is a suite error, not a quiet skip.
    throw new Error(
      `touch-targets: browser+server are available but no raw data at ${rawPath}. ` +
        `Run the collector first: npx playwright test ${COLLECTOR_SPEC}`,
      { cause: err },
    );
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
          violations: raw.undersized.map(sanitizeViolation),
        },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
