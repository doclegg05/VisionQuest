import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { percentile } from "./percentile";
import { percentile as scriptsPercentile } from "../../scripts/lib/percentile.mjs";

// The full behavioral contract is already pinned in percentile.test.ts
// against scripts/lib/percentile.mjs directly. This suite exists only to
// prove src/lib/percentile.ts is a real re-export of the SAME function
// (identity, not a copy that could drift) — production code should import
// from here rather than reaching across the src/scripts boundary itself.
describe("src/lib/percentile.ts re-export", () => {
  it("is reference-identical to scripts/lib/percentile.mjs's export", () => {
    assert.equal(percentile, scriptsPercentile);
  });

  it("behaves identically on a real call", () => {
    assert.equal(percentile([10, 20, 30], 50), scriptsPercentile([10, 20, 30], 50));
  });
});
