import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideVerdict, planWagerResolutions } from "./wagers";

const horizon = new Date("2026-06-15T00:00:00Z");

describe("decideVerdict", () => {
  it("wins when confirmed on or before the horizon", () => {
    assert.deepEqual(
      decideVerdict({ status: "confirmed", confirmedAt: new Date("2026-06-10T00:00:00Z") }, horizon),
      { outcome: "confirmed", result: "win" },
    );
  });

  it("loses when confirmed AFTER the horizon", () => {
    assert.deepEqual(
      decideVerdict({ status: "confirmed", confirmedAt: new Date("2026-06-16T00:00:00Z") }, horizon),
      { outcome: "expired_pending", result: "loss" },
    );
  });

  it("loses (dismissed) when abandoned", () => {
    assert.deepEqual(
      decideVerdict({ status: "abandoned", confirmedAt: null }, horizon),
      { outcome: "dismissed", result: "loss" },
    );
  });

  it("loses (expired) when still unconfirmed at the horizon", () => {
    assert.deepEqual(
      decideVerdict({ status: "proposed", confirmedAt: null }, horizon),
      { outcome: "expired_pending", result: "loss" },
    );
  });

  it("voids when the target goal is missing", () => {
    assert.deepEqual(decideVerdict(null, horizon), {
      outcome: "target_missing",
      result: "void",
    });
  });
});

describe("planWagerResolutions", () => {
  it("maps each open wager to a verdict + next status + evidence", () => {
    const wagers = [
      { id: "w1", targetId: "g1", horizonAt: horizon },
      { id: "w2", targetId: "g2", horizonAt: horizon },
      { id: "w3", targetId: "gone", horizonAt: horizon },
    ];
    const goals = new Map([
      ["g1", { status: "confirmed", confirmedAt: new Date("2026-06-10T00:00:00Z") }],
      ["g2", { status: "proposed", confirmedAt: null }],
    ]);

    const planned = planWagerResolutions(wagers, goals);

    assert.equal(planned.length, 3);
    assert.equal(planned[0].nextStatus, "won");
    assert.equal(planned[0].evidence.goalStatus, "confirmed");
    assert.equal(planned[1].nextStatus, "lost");
    assert.equal(planned[2].nextStatus, "void");
    assert.equal(planned[2].evidence.goalStatus, null);
    assert.equal(planned[0].evidence.horizonAt, horizon.toISOString());
  });
});
