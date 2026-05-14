import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeGoalProposalMetrics } from "./closed-loop-metrics";

describe("computeGoalProposalMetrics", () => {
  const period = {
    start: new Date("2026-05-01T00:00:00Z"),
    end: new Date("2026-06-01T00:00:00Z"),
  };

  it("tracks pending, confirmed, dismissed, and 14-day confirmation rate", () => {
    const metrics = computeGoalProposalMetrics(
      [
        {
          status: "proposed",
          createdAt: new Date("2026-05-02T00:00:00Z"),
          confirmedAt: null,
        },
        {
          status: "confirmed",
          createdAt: new Date("2026-05-03T00:00:00Z"),
          confirmedAt: new Date("2026-05-06T00:00:00Z"),
        },
        {
          status: "completed",
          createdAt: new Date("2026-05-01T00:00:00Z"),
          confirmedAt: new Date("2026-05-20T00:00:00Z"),
        },
        {
          status: "abandoned",
          createdAt: new Date("2026-05-08T00:00:00Z"),
          confirmedAt: null,
        },
      ],
      period,
    );

    assert.equal(metrics.totalProposed, 4);
    assert.equal(metrics.pending, 1);
    assert.equal(metrics.confirmed, 2);
    assert.equal(metrics.dismissed, 1);
    assert.equal(metrics.confirmationRate, 0.5);
    assert.equal(metrics.confirmedWithin14Days, 1);
    assert.equal(metrics.confirmationRateWithin14Days, 0.25);
    assert.equal(metrics.averageDaysToConfirmation, 11);
  });

  it("returns zero rates when there are no proposals", () => {
    const metrics = computeGoalProposalMetrics([], period);

    assert.equal(metrics.totalProposed, 0);
    assert.equal(metrics.confirmationRate, 0);
    assert.equal(metrics.confirmationRateWithin14Days, 0);
    assert.equal(metrics.averageDaysToConfirmation, null);
  });
});
