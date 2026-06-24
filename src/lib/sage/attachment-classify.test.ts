import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

let shouldRecomputeClassification: typeof import("./attachment-classify").shouldRecomputeClassification;

before(async () => {
  ({ shouldRecomputeClassification } = await import("./attachment-classify"));
});

describe("shouldRecomputeClassification", () => {
  it("recomputes when there is no cache", () => {
    assert.equal(shouldRecomputeClassification(false, null, false), true);
    assert.equal(shouldRecomputeClassification(false, null, true), true);
  });

  it("reuses an existing cloud result regardless of consent", () => {
    assert.equal(shouldRecomputeClassification(true, "cloud", true), false);
    assert.equal(shouldRecomputeClassification(true, "cloud", false), false);
  });

  it("upgrades a local/none baseline to cloud once consent is granted", () => {
    assert.equal(shouldRecomputeClassification(true, "local", true), true);
    assert.equal(shouldRecomputeClassification(true, "none", true), true);
  });

  it("keeps the local baseline when cloud is not allowed", () => {
    assert.equal(shouldRecomputeClassification(true, "local", false), false);
    assert.equal(shouldRecomputeClassification(true, "none", false), false);
  });
});
