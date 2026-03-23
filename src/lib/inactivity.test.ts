import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_INACTIVITY_ALERT_TYPES,
  getDaysSinceActivity,
  getInactivityStage,
  getInactivityStageByType,
  getInactivityStageRank,
  isInactivityAlertType,
  normalizeInactivityAlertType,
} from "./inactivity";

test("getDaysSinceActivity floors elapsed days", () => {
  const days = getDaysSinceActivity(
    new Date("2026-03-01T12:00:00.000Z"),
    new Date("2026-03-16T11:59:59.000Z"),
  );

  assert.equal(days, 14);
});

test("getInactivityStage returns the expected thresholds", () => {
  assert.equal(getInactivityStage(13), null);
  assert.equal(getInactivityStage(14)?.type, "inactive_student_14");
  assert.equal(getInactivityStage(30)?.type, "inactive_student_30");
  assert.equal(getInactivityStage(60)?.type, "inactive_student_60");
  assert.equal(getInactivityStage(90)?.type, "inactive_student_90");
});

test("legacy inactivity alerts normalize into the new follow-up stage", () => {
  assert.equal(normalizeInactivityAlertType("inactive_student"), "inactive_student_14");
  assert.ok(isInactivityAlertType("inactive_student"));
  assert.ok(isInactivityAlertType("inactive_student_60"));
});

test("getInactivityStageByType exposes the stage label and action text", () => {
  const stage = getInactivityStageByType("inactive_student_90");

  assert.equal(stage?.label, "90-day archive review");
  assert.match(stage?.nextStep || "", /archive/i);
});

test("getInactivityStageRank keeps higher-age stages above follow-up stages", () => {
  assert.ok(getInactivityStageRank("inactive_student_90") > getInactivityStageRank("inactive_student_14"));
  assert.ok(ALL_INACTIVITY_ALERT_TYPES.includes("inactive_student_30"));
});
