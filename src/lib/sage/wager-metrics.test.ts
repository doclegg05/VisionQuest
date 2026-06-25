import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeWagerHitRate } from "./wager-metrics";

describe("computeWagerHitRate", () => {
  it("hitRate = won / (won + lost); open and void excluded from denominator", () => {
    const m = computeWagerHitRate([
      { status: "won" },
      { status: "won" },
      { status: "lost" },
      { status: "open" },
      { status: "void" },
    ]);
    assert.equal(m.won, 2);
    assert.equal(m.lost, 1);
    assert.equal(m.open, 1);
    assert.equal(m.voided, 1);
    assert.equal(m.hitRate, 2 / 3);
  });

  it("hitRate is 0 when there are no settled wagers", () => {
    const m = computeWagerHitRate([{ status: "open" }, { status: "void" }]);
    assert.equal(m.hitRate, 0);
  });
});
