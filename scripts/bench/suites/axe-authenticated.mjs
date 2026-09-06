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
 *
 * `details` is committed (reports/benchmarks/latest/*.json) — never student
 * data. The collector spec records only route SHAPES (e.g.
 * "/teacher/students/:id"), never a resolved student id — see that spec's
 * own comment and axe-authenticated.test.mjs's pinning test.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const RAW_DATA_PATH = join(REPO_ROOT, "reports/benchmarks/raw/axe-authenticated.json");
const COLLECTOR_SPEC = "e2e/bench-axe-authenticated.spec.ts";

export async function run(ctx) {
  const rawPath = ctx?.rawDataPath ?? RAW_DATA_PATH;
  const requirementsMet = Boolean(ctx?.env?.playwright) && Boolean(ctx?.env?.baseUrl);

  let raw;
  try {
    raw = JSON.parse(readFileSync(rawPath, "utf8"));
  } catch (err) {
    if (!requirementsMet) {
      return {
        metrics: [
          {
            id: "violations_total",
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
    throw new Error(
      `axe-authenticated: browser+server are available but no raw data at ${rawPath}. ` +
        `Run the collector first: npx playwright test ${COLLECTOR_SPEC}`,
      { cause: err },
    );
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

await selfTest(import.meta.url, run);
