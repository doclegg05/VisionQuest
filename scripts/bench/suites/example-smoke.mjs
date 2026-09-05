/**
 * Example benchmark suite — the reference an author copies.
 *
 * It scores the shared nearest-rank percentile helper (scripts/lib/
 * percentile.mjs) against a committed fixture of labelled expectations. That
 * is deliberately trivial: this suite exists to exercise the runner end to
 * end on any machine, with no database, no API key and no browser, so a
 * broken runner is caught by the runner's own gate rather than by a suite
 * that also needs a secret.
 *
 * The four things every scorer does:
 *   1. read its corpus from `ctx.fixture` (the runner parsed it already)
 *   2. call PRODUCTION code — import it, never copy the logic into the
 *      fixture or the scorer, or the benchmark measures a copy that cannot
 *      drift with the app
 *   3. return `{ metrics: [{ id, value, n, details }] }` with one entry per
 *      metric declared in config/benchmarks/<suite>.json
 *   4. hand back evidence in `details` — which cases missed, never a student
 *
 * Run it standalone, before or without the runner:
 *   node scripts/bench/suites/example-smoke.mjs --self-test
 */

import { percentile } from "../../lib/percentile.mjs";
import { selfTest } from "../lib/self-test.mjs";

/**
 * @param {{ fixture: {cases: {label: string, values: number[], p: number, expected: number|null}[]}, log: (...args: unknown[]) => void }} ctx
 */
export async function run(ctx) {
  const cases = ctx.fixture?.cases ?? [];
  const failures = [];

  for (const testCase of cases) {
    let actual;
    try {
      actual = percentile(testCase.values, testCase.p);
    } catch (error) {
      actual = `threw: ${error.message}`;
    }
    if (actual !== testCase.expected) {
      failures.push({ label: testCase.label, p: testCase.p, expected: testCase.expected, actual });
    }
  }

  const accuracy = cases.length === 0 ? 0 : (cases.length - failures.length) / cases.length;
  ctx.log(`${cases.length - failures.length}/${cases.length} percentile cases correct`);

  return {
    metrics: [
      {
        id: "accuracy",
        value: accuracy,
        n: cases.length,
        details: { failures },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
