import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateCoverage } from "./coverage-aggregate.mjs";

test("aggregateCoverage: sums LH/LF only over eligible files, ignoring test files and node_modules noise", () => {
  const eligible = ["src/lib/foo.ts", "src/lib/bar.ts"];
  const lcovRecords = [
    { file: "../../src/lib/foo.ts", linesFound: 10, linesHit: 8 },
    { file: "../../src/lib/bar.ts", linesFound: 5, linesHit: 0 },
    { file: "../../src/lib/foo.test.ts", linesFound: 20, linesHit: 20 },
    { file: "node_modules/some-pkg/index.js", linesFound: 100, linesHit: 100 },
  ];
  const agg = aggregateCoverage(eligible, lcovRecords);
  assert.equal(agg.totalLinesFound, 15);
  assert.equal(agg.totalLinesHit, 8);
  assert.equal(agg.coverageRatio, 8 / 15);
  assert.equal(agg.reportedFileCount, 2);
});

test("aggregateCoverage: a file with zero lines hit is a force-import zero-coverage file", () => {
  const eligible = ["src/lib/bar.ts"];
  const lcovRecords = [{ file: "src/lib/bar.ts", linesFound: 5, linesHit: 0 }];
  const agg = aggregateCoverage(eligible, lcovRecords);
  assert.deepEqual(agg.forceImportZeroCoverageFiles, ["src/lib/bar.ts"]);
});

test("aggregateCoverage: an eligible file absent from the lcov report entirely (import failed) is a force-import zero-coverage file", () => {
  const eligible = ["src/lib/never-imported.ts"];
  const agg = aggregateCoverage(eligible, []);
  assert.deepEqual(agg.forceImportZeroCoverageFiles, ["src/lib/never-imported.ts"]);
  assert.equal(agg.reportedFileCount, 0);
});

test("aggregateCoverage: a duplicate SF entry for the same file keeps the fuller instrumentation, not a naive sum", () => {
  const eligible = ["src/lib/foo.ts"];
  const lcovRecords = [
    { file: "src/lib/foo.ts", linesFound: 10, linesHit: 5 },
    { file: "src/lib/foo.ts", linesFound: 10, linesHit: 5 },
  ];
  const agg = aggregateCoverage(eligible, lcovRecords);
  // Naive summing would double-count to 20/10; the aggregate must not do that.
  assert.equal(agg.totalLinesFound, 10);
  assert.equal(agg.totalLinesHit, 5);
});

test("aggregateCoverage: zero eligible files reports ratio 0, not NaN", () => {
  const agg = aggregateCoverage([], []);
  assert.equal(agg.coverageRatio, 0);
});
