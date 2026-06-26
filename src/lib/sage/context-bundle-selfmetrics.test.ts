import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSelfMetricLine } from "./context-bundle";

describe("formatSelfMetricLine", () => {
  it("summarizes the goal-proposal hit-rate for the prompt", () => {
    const line = formatSelfMetricLine({ won: 4, lost: 6, hitRate: 0.4 });
    assert.match(line, /4/);
    assert.match(line, /10|40%/);
  });

  it("is empty when there are no settled wagers", () => {
    assert.equal(formatSelfMetricLine({ won: 0, lost: 0, hitRate: 0 }), "");
  });
});
