import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { topClusterIds } from "./discovery-extractor";

describe("topClusterIds", () => {
  it("returns top clusters by score above threshold", () => {
    const scores = {
      "office-admin": 0.8,
      "finance-bookkeeping": 0.6,
      "tech-digital": 0.2,
      "creative-design": 0.1,
      "customer-service": 0.9,
    };
    const top = topClusterIds(scores, 2, 0.3);
    assert.deepEqual(top, ["customer-service", "office-admin"]);
  });

  it("returns empty array when all scores are below threshold", () => {
    const scores = {
      "office-admin": 0.1,
      "tech-digital": 0.2,
    };
    assert.deepEqual(topClusterIds(scores, 2, 0.3), []);
  });

  it("returns fewer than count when not enough clusters qualify", () => {
    const scores = {
      "office-admin": 0.8,
      "tech-digital": 0.1,
    };
    assert.deepEqual(topClusterIds(scores, 2, 0.3), ["office-admin"]);
  });

  it("handles empty scores", () => {
    assert.deepEqual(topClusterIds({}, 2, 0.3), []);
  });
});
