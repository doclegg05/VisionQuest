import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { regionChoiceFor, regionMoveConfirm, regionPatchFor } from "./class-region-choice";

describe("the region picked in class settings", () => {
  it("starts on the class's current region", () => {
    assert.equal(regionChoiceFor(null, "class-a", "region-1"), "region-1");
  });

  it("starts on no pick when the class has no region yet", () => {
    assert.equal(regionChoiceFor(null, "class-a", null), "");
  });

  it("adds nothing to the save when the pick is the current region, so the class stays put", () => {
    assert.deepEqual(regionPatchFor(null, "class-a", "region-1"), {});
    assert.deepEqual(regionPatchFor({ classId: "class-a", regionId: "region-1" }, "class-a", "region-1"), {});
  });

  it("sends a different region picked for the class being saved", () => {
    const choice = { classId: "class-a", regionId: "region-2" };
    assert.deepEqual(regionPatchFor(choice, "class-a", "region-1"), { regionId: "region-2" });
    assert.equal(regionChoiceFor(choice, "class-a", "region-1"), "region-2");
  });

  it("never carries a pick made for one class over to another class", () => {
    const choice = { classId: "class-a", regionId: "region-2" };
    assert.deepEqual(regionPatchFor(choice, "class-b", "region-1"), {});
    assert.equal(regionChoiceFor(choice, "class-b", "region-1"), "region-1");
  });

  it("treats the empty placeholder as no pick", () => {
    assert.deepEqual(regionPatchFor({ classId: "class-a", regionId: "" }, "class-a", null), {});
  });
});

describe("confirming a region move", () => {
  it("names the class, both regions, and who stops seeing it", () => {
    const copy = regionMoveConfirm({ className: "Morning", from: "North", to: "East" });
    assert.ok(copy);
    assert.equal(copy.title, "Move Morning from North to East?");
    assert.equal(copy.message, "Coordinators of North will stop seeing it.");
    assert.equal(copy.destructive, true, "it takes access away, so the button is red");
  });

  it("asks nothing when the class had no region, because no one loses access", () => {
    assert.equal(regionMoveConfirm({ className: "Morning", from: null, to: "East" }), null);
  });
});
