import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { __private, currentMonthBounds, GRANT_METRICS } from "./grant-metrics";

const { computeGoalStatus } = __private;

describe("currentMonthBounds", () => {
  it("returns UTC first-of-month as start and first-of-next-month as end", () => {
    const ref = new Date("2026-04-17T15:30:00Z");
    const { start, end } = currentMonthBounds(ref);
    assert.equal(start.toISOString(), "2026-04-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2026-05-01T00:00:00.000Z");
  });

  it("wraps to next year across December", () => {
    const ref = new Date("2026-12-31T23:59:59Z");
    const { start, end } = currentMonthBounds(ref);
    assert.equal(start.toISOString(), "2026-12-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2027-01-01T00:00:00.000Z");
  });
});

describe("GRANT_METRICS catalog", () => {
  it("exposes the five metric kinds the UI and API depend on", () => {
    assert.deepEqual([...GRANT_METRICS], [
      "enrollments",
      "certifications",
      "placements",
      "ged_earned",
      "custom",
    ]);
  });
});

describe("computeGoalStatus", () => {
  const start = new Date("2026-04-01T00:00:00Z");
  const end = new Date("2026-05-01T00:00:00Z");

  it("returns not_started for zero target", () => {
    assert.equal(computeGoalStatus(0, 0, start, end, new Date("2026-04-15T00:00:00Z")), "not_started");
  });

  it("returns on_track once actual meets or exceeds target", () => {
    assert.equal(computeGoalStatus(10, 10, start, end, new Date("2026-04-15T00:00:00Z")), "on_track");
    assert.equal(computeGoalStatus(12, 10, start, end, new Date("2026-04-15T00:00:00Z")), "on_track");
  });

  it("classifies as at_risk when actual is behind pace but within 60% of expected", () => {
    // Half-month: expected 50% progress. Actual at 35% = 70% of expected → at_risk.
    const halfway = new Date("2026-04-15T12:00:00Z");
    assert.equal(computeGoalStatus(35, 100, start, end, halfway), "at_risk");
  });

  it("classifies as behind when actual is less than 60% of expected", () => {
    const halfway = new Date("2026-04-15T12:00:00Z");
    assert.equal(computeGoalStatus(20, 100, start, end, halfway), "behind");
  });

  it("returns at_risk or behind immediately when progress is zero — status is ratio-based, not grace-period-based", () => {
    const day1 = new Date("2026-04-01T01:00:00Z");
    // Zero progress against any non-zero elapsed time fails both thresholds.
    assert.equal(computeGoalStatus(0, 100, start, end, day1), "behind");
  });
});
