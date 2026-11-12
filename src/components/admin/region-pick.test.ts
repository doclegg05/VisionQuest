import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickedRegionId } from "./region-pick";

const north = { id: "r1", name: "North" };
const east = { id: "r2", name: "East" };

describe("the region a form has picked, read from the current list", () => {
  it("keeps the pick while it is still in the list", () => {
    assert.equal(pickedRegionId([north, east], "r2"), "r2");
  });

  it("falls back to the first region when nothing was picked yet", () => {
    assert.equal(pickedRegionId([north, east], ""), "r1");
  });

  it("picks up the first region once one is added to an empty list", () => {
    assert.equal(pickedRegionId([], ""), "");
    assert.equal(pickedRegionId([north], ""), "r1");
  });

  it("never keeps a pick that left the list", () => {
    assert.equal(pickedRegionId([east], "r1"), "r2");
  });
});
