import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { percentile } from "../../scripts/lib/percentile.mjs";

describe("percentile (scripts/lib/percentile.mjs)", () => {
  describe("boundaries", () => {
    it("returns null for an empty array", () => {
      assert.equal(percentile([], 50), null);
      assert.equal(percentile([], 95), null);
    });

    it("returns the single element for any p", () => {
      assert.equal(percentile([100], 0), 100);
      assert.equal(percentile([100], 50), 100);
      assert.equal(percentile([100], 100), 100);
    });

    it("p=0 returns the minimum (first element)", () => {
      assert.equal(percentile([1, 2, 3], 0), 1);
      assert.equal(percentile([5, 5, 5, 10, 10, 20, 20, 20, 50, 100], 0), 5);
    });

    it("p=100 returns the maximum (last element)", () => {
      assert.equal(percentile([1, 2, 3], 100), 3);
      assert.equal(percentile([5, 5, 5, 10, 10, 20, 20, 20, 50, 100], 100), 100);
    });

    it("nearest-rank: p50 of an even-length array is the lower middle element", () => {
      assert.equal(percentile([100, 200], 50), 100);
      assert.equal(
        percentile(
          Array.from({ length: 20 }, (_, i) => (i + 1) * 10),
          50,
        ),
        100,
      );
    });

    it("a fractional p near zero is the p-th percentile, NOT a 0-1 fraction", () => {
      // The convention trap this module exists to close: percentile(sorted, 0.5)
      // is the 0.5th percentile (≈ minimum), never the median.
      assert.equal(percentile([1, 2, 3], 0.5), 1);
      assert.equal(
        percentile(
          Array.from({ length: 100 }, (_, i) => i),
          0.5,
        ),
        0,
      );
    });

    it("throws RangeError for p outside [0, 100] or non-finite p", () => {
      assert.throws(() => percentile([1, 2, 3], -1), RangeError);
      assert.throws(() => percentile([1, 2, 3], 101), RangeError);
      assert.throws(() => percentile([1, 2, 3], Number.NaN), RangeError);
      assert.throws(() => percentile([1, 2, 3], Number.POSITIVE_INFINITY), RangeError);
    });

    it("does not mutate its input", () => {
      const frozen = Object.freeze([1, 2, 3]);
      assert.equal(percentile(frozen, 95), 3);
    });
  });

  // Red-baseline: these expected values were captured from the four
  // pre-extraction in-script implementations (sage-load-test, sage-usage-summary,
  // sage-chat-harness, sage-rag-harness) run over this fixture BEFORE the swap
  // to the shared module. The `?? 0` adapters mirror the exact post-swap
  // call-site expressions in every caller except sage-load-test, which keeps
  // null-for-empty. Equality here proves the swap changed no observable output.
  describe("red-baseline equivalence with the pre-extraction implementations", () => {
    const FIXTURE: Record<string, number[]> = {
      empty: [],
      single: [100],
      pair: [100, 200],
      triple: [1, 2, 3],
      tenWithTies: [5, 5, 5, 10, 10, 20, 20, 20, 50, 100],
      twenty: Array.from({ length: 20 }, (_, i) => (i + 1) * 10),
      hundred: Array.from({ length: 100 }, (_, i) => i),
      floats: [0.5, 1.25, 2.75, 3.5, 9.99],
    };

    // { fixture: [loadTest p50, loadTest p95, harness/summary p50, harness/summary p95] }
    const BASELINE: Record<string, [number | null, number | null, number, number]> = {
      empty: [null, null, 0, 0],
      single: [100, 100, 100, 100],
      pair: [100, 200, 100, 200],
      triple: [2, 3, 2, 3],
      tenWithTies: [10, 100, 10, 100],
      twenty: [100, 190, 100, 190],
      hundred: [49, 94, 49, 94],
      floats: [2.75, 9.99, 2.75, 9.99],
    };

    for (const [name, values] of Object.entries(FIXTURE)) {
      it(`matches the captured baseline for the "${name}" fixture`, () => {
        const [loadP50, loadP95, adaptedP50, adaptedP95] = BASELINE[name];
        // sage-load-test.mjs call sites (null-for-empty preserved verbatim)
        assert.equal(percentile(values, 50), loadP50);
        assert.equal(percentile(values, 95), loadP95);
        // sage-chat-harness.mjs / sage-usage-summary.mjs call sites (0-for-empty via ?? 0)
        assert.equal(percentile(values, 50) ?? 0, adaptedP50);
        assert.equal(percentile(values, 95) ?? 0, adaptedP95);
      });
    }
  });
});
