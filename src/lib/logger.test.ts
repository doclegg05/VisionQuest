import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requestId } from "./logger";

describe("requestId", () => {
  it("returns a non-empty string", () => {
    const id = requestId();
    assert.ok(typeof id === "string");
    assert.ok(id.length > 0);
  });

  it("returns unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => requestId()));
    assert.equal(ids.size, 100);
  });
});
