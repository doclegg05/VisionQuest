/**
 * Benchmark: rag-retrieval.
 *
 * Promotes scripts/sage-rag-harness.mjs (unmodified) to a gated numeric
 * benchmark. See config/benchmarks/rag-retrieval.json for why this needs
 * `prod-readonly` rather than the hermetic `postgres` CI database.
 *
 * Self-test:
 *   BENCH_PROD_READONLY_URL=postgresql://... \
 *     node --import tsx scripts/bench/suites/rag-retrieval.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { runScriptForJsonReport } from "./lib/run-cli.mjs";

const FIXTURES = ["config/sage-rag-eval.json", "config/sage-rag-top-questions.json"];

/** Pure aggregation over already-produced harness reports — unit-testable. */
export function aggregateRagReports(reports) {
  let expectedChecks = 0;
  let top1Expected = 0;
  let top3Expected = 0;
  let cleanTop3 = 0;
  const latencies = [];
  const missing = [];

  for (const report of reports) {
    expectedChecks += report.expectedChecks ?? 0;
    top1Expected += report.top1Expected ?? 0;
    top3Expected += report.top3Expected ?? 0;
    cleanTop3 += report.cleanTop3 ?? 0;
    for (const r of report.results ?? []) {
      if (typeof r.latencyMs === "number") latencies.push(r.latencyMs);
    }
    if (report.missingExpectationKeys?.length) {
      missing.push({ fixturePath: report.fixturePath, keys: report.missingExpectationKeys });
    }
  }

  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : 0;

  return {
    expectedChecks,
    top1Rate: expectedChecks ? top1Expected / expectedChecks : 0,
    top3Rate: expectedChecks ? top3Expected / expectedChecks : 0,
    cleanTop3Rate: expectedChecks ? cleanTop3 / expectedChecks : 0,
    p95LatencyMs: p95,
    missingExpectationKeys: missing,
  };
}

export async function run(ctx) {
  const dbUrl = ctx.env?.prodReadonlyUrl ?? process.env.BENCH_PROD_READONLY_URL;
  if (!dbUrl) {
    throw new Error(
      "rag-retrieval requires BENCH_PROD_READONLY_URL (a read-only prod replica) — see config/benchmarks/rag-retrieval.json notes.",
    );
  }

  const reports = [];
  for (const fixturePath of FIXTURES) {
    const report = await runScriptForJsonReport(
      "scripts/sage-rag-harness.mjs",
      [`--fixture=${fixturePath}`],
      { env: { DATABASE_URL: dbUrl } },
    );
    reports.push(report);
  }

  const agg = aggregateRagReports(reports);

  return {
    metrics: [
      { id: "top3", value: agg.top3Rate, n: agg.expectedChecks },
      { id: "clean_top3", value: agg.cleanTop3Rate, n: agg.expectedChecks },
      { id: "top1", value: agg.top1Rate, n: agg.expectedChecks },
      {
        id: "p95_latency_ms",
        value: agg.p95LatencyMs,
        n: reports.reduce((sum, r) => sum + (r.results?.length ?? 0), 0),
        details: { missingExpectationKeys: agg.missingExpectationKeys },
      },
    ],
  };
}

await maybeRunSelfTest({ suite: "rag-retrieval", run, importMeta: import.meta });
