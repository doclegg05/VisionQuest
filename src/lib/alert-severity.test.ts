import assert from "node:assert/strict";
import test from "node:test";
import { alertSeverityRank, isUrgentSeverity } from "./alert-severity";

test("critical outranks high, high outranks medium, unknown ranks with low", () => {
  assert.ok(alertSeverityRank("critical") > alertSeverityRank("high"));
  assert.ok(alertSeverityRank("high") > alertSeverityRank("medium"));
  assert.ok(alertSeverityRank("medium") > alertSeverityRank("low"));
  assert.equal(alertSeverityRank("surprise"), alertSeverityRank("low"));
});

test("critical and high are urgent; medium and low are not", () => {
  assert.equal(isUrgentSeverity("critical"), true);
  assert.equal(isUrgentSeverity("high"), true);
  assert.equal(isUrgentSeverity("medium"), false);
  assert.equal(isUrgentSeverity("low"), false);
});
