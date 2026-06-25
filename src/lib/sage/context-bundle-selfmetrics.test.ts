import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSelfMetricLine } from "./context-bundle";

describe("formatSelfMetricLine", () => {
  it("summarizes the goal-proposal hit-rate for the prompt", () => {
    const line = formatSelfMetricLine({ open: 1, won: 4, lost: 6, voided: 0, hitRate: 0.4 });
    assert.match(line, /4/);
    assert.match(line, /10|40%/);
  });

  it("is empty when there are no settled wagers", () => {
    assert.equal(formatSelfMetricLine({ open: 0, won: 0, lost: 0, voided: 0, hitRate: 0 }), "");
  });
});
