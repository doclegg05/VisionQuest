import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { regionChoiceFor, regionPatchFor } from "./class-region-choice";

describe("the region picked in class settings", () => {
  it("adds nothing to the save when no region was picked, so the class keeps its region", () => {
    assert.deepEqual(regionPatchFor(null, "class-a"), {});
    assert.equal(regionChoiceFor(null, "class-a"), "");
  });

  it("sends the region picked for the class being saved", () => {
    const choice = { classId: "class-a", regionId: "region-1" };
    assert.deepEqual(regionPatchFor(choice, "class-a"), { regionId: "region-1" });
    assert.equal(regionChoiceFor(choice, "class-a"), "region-1");
  });

  it("never carries a pick made for one class over to another class", () => {
    const choice = { classId: "class-a", regionId: "region-1" };
    assert.deepEqual(regionPatchFor(choice, "class-b"), {});
    assert.equal(regionChoiceFor(choice, "class-b"), "");
  });

  it("treats picking the keep option as no pick", () => {
    const choice = { classId: "class-a", regionId: "" };
    assert.deepEqual(regionPatchFor(choice, "class-a"), {});
  });
});
