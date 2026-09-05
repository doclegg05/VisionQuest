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

test("the floor is evaluated before the exact rule, so an exact metric can still fail on it", () => {
  const exact = { id: "p", unit: "count", exact: true, floor: 0, tolerance: 100, direction: "higher" };
  // Floor met, baseline disagrees -> the exact rule decides.
  assert.equal(metricStatus(exact, 3, 4), "fail");
  // Floor crossed -> fail on the floor, whatever the baseline says.
  assert.equal(metricStatus(exact, -1, -1), "fail");
});

test("a gate-shaped exact metric with a floor and NO baseline can still fail", () => {
  // The live shapes this guards: hard-blocks.blocks_expected_fired (floor 1,
  // higher) and connection-walks.illegal_accepted (floor 0, lower), both
  // `exact`, both on gate suites, against an EMPTY baseline.json. Before this,
  // the exact branch returned `info` whenever there was no baseline and never
  // consulted the floor — so 0.3 blocks fired, or 40 illegal transitions
  // accepted, reported INFO and the gate could not fail.
  const blocksFired = { id: "blocks_expected_fired", unit: "ratio", direction: "higher", floor: 1, exact: true, tolerance: 0 };
  assert.equal(metricStatus(blocksFired, 0.3, null), "fail");
  assert.equal(metricStatus(blocksFired, 1, null), "pass");

  const illegalAccepted = { id: "illegal_accepted", unit: "count", direction: "lower", floor: 0, exact: true, tolerance: 0 };
  assert.equal(metricStatus(illegalAccepted, 40, null), "fail");
  assert.equal(metricStatus(illegalAccepted, 0, null), "pass");
});

test("an exact metric whose floor is met with no baseline is a pass, not info", () => {
  // The floor is a promise, and it was kept. `info` is for a metric that
  // promised nothing.
  const withFloor = { id: "parity", unit: "count", direction: "lower", floor: 0, exact: true };
  assert.equal(metricStatus(withFloor, 0, null), "pass");

  const withoutFloor = { id: "parity", unit: "count", exact: true };
  assert.equal(metricStatus(withoutFloor, 0, null), "info", "no floor and no baseline still promises nothing");
});

test("an exact metric with a floor met and a matching baseline passes", () => {
  const exact = { id: "parity", unit: "count", direction: "lower", floor: 0, exact: true };
  assert.equal(metricStatus(exact, 0, 0), "pass");
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
