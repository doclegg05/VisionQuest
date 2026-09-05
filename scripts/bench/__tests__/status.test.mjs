// Unit tests for the pure status function: metric config + value + baseline
// -> pass | watch | fail | info | skipped. Every branch is exercised because
// this function is the whole gate: a wrong verdict here either hides a
// regression or fails a PR that never broke anything.
import test from "node:test";
import assert from "node:assert/strict";

import { metricStatus, worstStatus, STATUSES, STATUS_SEVERITY } from "../lib/status.mjs";

const higher = { id: "recall", unit: "ratio", direction: "higher", floor: 0.98, tolerance: 0.01 };
const lower = { id: "fp", unit: "ratio", direction: "lower", floor: 0.02, tolerance: 0.005 };
const floorless = { id: "trend", unit: "grade", direction: "lower", tolerance: 0.5 };

test("STATUSES lists every status the schema allows", () => {
  assert.deepEqual([...STATUSES].sort(), ["error", "fail", "info", "pass", "skipped", "watch"]);
});

test("a null value is skipped, not a failure", () => {
  assert.equal(metricStatus(higher, null, 0.99), "skipped");
  assert.equal(metricStatus(higher, undefined, 0.99), "skipped");
});

test("a non-finite value fails loudly instead of reading as skipped", () => {
  assert.equal(metricStatus(higher, Number.NaN, 0.99), "fail");
  assert.equal(metricStatus(floorless, Number.POSITIVE_INFINITY, null), "fail");
});

test("direction higher: below the floor fails, at the floor passes", () => {
  assert.equal(metricStatus(higher, 0.97, null), "fail");
  assert.equal(metricStatus(higher, 0.98, null), "pass");
  assert.equal(metricStatus(higher, 1, null), "pass");
});

test("direction lower: above the floor fails, at the floor passes", () => {
  assert.equal(metricStatus(lower, 0.03, null), "fail");
  assert.equal(metricStatus(lower, 0.02, null), "pass");
  assert.equal(metricStatus(lower, 0, null), "pass");
});

test("a floor breach beats a tolerance breach", () => {
  assert.equal(metricStatus(higher, 0.5, 0.99), "fail");
});

test("direction higher: below baseline minus tolerance but above the floor watches", () => {
  assert.equal(metricStatus(higher, 0.985, 0.999), "watch");
  assert.equal(metricStatus(higher, 0.99, 0.999), "pass", "inside tolerance is a pass");
});

test("direction lower: above baseline plus tolerance but under the floor watches", () => {
  assert.equal(metricStatus(lower, 0.019, 0.01), "watch");
  assert.equal(metricStatus(lower, 0.012, 0.01), "pass");
});

test("no floor and no baseline is info, never pass", () => {
  assert.equal(metricStatus(floorless, 5.2, null), "info");
  assert.equal(metricStatus({ id: "n", unit: "count", direction: "higher" }, 12, undefined), "info");
});

test("no floor but a tolerance breach still watches", () => {
  assert.equal(metricStatus(floorless, 6.2, 5.0), "watch");
  assert.equal(metricStatus(floorless, 5.2, 5.0), "info", "inside tolerance with no floor stays info");
});

test("a baseline with no tolerance never opens a watch on its own", () => {
  const noTolerance = { id: "x", unit: "ratio", direction: "higher", floor: 0.5 };
  assert.equal(metricStatus(noTolerance, 0.6, 0.99), "pass");
});

test("exact: equality passes, difference fails, no baseline is info", () => {
  const exact = { id: "placements", unit: "count", exact: true };
  assert.equal(metricStatus(exact, 12, 12), "pass");
  assert.equal(metricStatus(exact, 11, 12), "fail");
  assert.equal(metricStatus(exact, 11, null), "info");
});

test("exact ignores floor and tolerance when a baseline exists", () => {
  const exact = { id: "p", unit: "count", exact: true, floor: 0, tolerance: 100, direction: "higher" };
  assert.equal(metricStatus(exact, 3, 4), "fail");
});

test("worstStatus ranks error over fail over watch over pass over info over skipped", () => {
  assert.equal(worstStatus(["pass", "watch", "info"]), "watch");
  assert.equal(worstStatus(["pass", "fail", "watch"]), "fail");
  assert.equal(worstStatus(["fail", "error"]), "error");
  assert.equal(worstStatus(["skipped", "skipped"]), "skipped");
  assert.equal(worstStatus(["info", "skipped"]), "info");
  assert.equal(worstStatus([]), "skipped");
  assert.ok(STATUS_SEVERITY.fail > STATUS_SEVERITY.watch);
});
