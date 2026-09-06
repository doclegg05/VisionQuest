import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRagReports } from "./rag-retrieval.mjs";

test("aggregateRagReports: sums expectation-bearing counts across multiple harness reports", () => {
  const agg = aggregateRagReports([
    {
      fixturePath: "a.json",
      expectedChecks: 20,
      top1Expected: 18,
      top3Expected: 19,
      cleanTop3: 17,
      results: [{ latencyMs: 10 }, { latencyMs: 20 }],
    },
    {
      fixturePath: "b.json",
      expectedChecks: 40,
      top1Expected: 30,
      top3Expected: 38,
      cleanTop3: 35,
      results: [{ latencyMs: 100 }],
    },
  ]);
  assert.equal(agg.expectedChecks, 60);
  assert.equal(agg.top1Rate, 48 / 60);
  assert.equal(agg.top3Rate, 57 / 60);
  assert.equal(agg.cleanTop3Rate, 52 / 60);
});

test("aggregateRagReports: zero expectation-bearing cases reports 0 rates, not NaN", () => {
  const agg = aggregateRagReports([{ fixturePath: "a.json", expectedChecks: 0, results: [] }]);
  assert.equal(agg.top1Rate, 0);
  assert.equal(agg.top3Rate, 0);
  assert.equal(agg.cleanTop3Rate, 0);
});

test("aggregateRagReports: p95 latency is computed over the pooled per-question latencies", () => {
  const latencies = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
  const agg = aggregateRagReports([
    { fixturePath: "a.json", expectedChecks: 1, top1Expected: 1, top3Expected: 1, cleanTop3: 1, results: latencies.map((ms) => ({ latencyMs: ms })) },
  ]);
  // 95th percentile of 1..20 (nearest-rank) is the 19th value.
  assert.equal(agg.p95LatencyMs, 19);
});

test("aggregateRagReports: surfaces missing expectation storage keys per fixture", () => {
  const agg = aggregateRagReports([
    { fixturePath: "a.json", expectedChecks: 1, results: [], missingExpectationKeys: ["forms/missing.pdf"] },
  ]);
  assert.deepEqual(agg.missingExpectationKeys, [{ fixturePath: "a.json", keys: ["forms/missing.pdf"] }]);
});
