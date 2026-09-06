import { test } from "node:test";
import assert from "node:assert/strict";
import { ferpaRoutingMetric } from "./ferpa-routing.mjs";

test("ferpaRoutingMetric: info mode reports the ratio without throwing, any value", () => {
  const metric = ferpaRoutingMetric({ cloudCompleted: 3, totalCompleted: 10, localHostExpected: false });
  assert.equal(metric.id, "student_record_cloud_ratio");
  assert.equal(metric.value, 0.3);
  assert.equal(metric.n, 10);
  assert.equal(metric.details.localHostExpected, false);
  assert.match(metric.details.headerNote, /informational/);
});

test("ferpaRoutingMetric: info mode with zero completed calls reports 0, not NaN", () => {
  const metric = ferpaRoutingMetric({ cloudCompleted: 0, totalCompleted: 0, localHostExpected: false });
  assert.equal(metric.value, 0);
  assert.equal(metric.n, 0);
});

test("ferpaRoutingMetric: gated mode with ratio 0 passes clean", () => {
  const metric = ferpaRoutingMetric({ cloudCompleted: 0, totalCompleted: 25, localHostExpected: true });
  assert.equal(metric.value, 0);
  assert.match(metric.details.headerNote, /gated at floor 0/);
});

test("ferpaRoutingMetric: gated mode with any cloud call throws (floor 0 breach)", () => {
  assert.throws(
    () => ferpaRoutingMetric({ cloudCompleted: 1, totalCompleted: 25, localHostExpected: true }),
    /FERPA ROUTING FLOOR BREACHED/
  );
});

test("ferpaRoutingMetric: gated mode with zero completed calls does not throw (nothing to breach)", () => {
  const metric = ferpaRoutingMetric({ cloudCompleted: 0, totalCompleted: 0, localHostExpected: true });
  assert.equal(metric.value, 0);
});
