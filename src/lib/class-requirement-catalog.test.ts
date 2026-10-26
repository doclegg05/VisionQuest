import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { READY_TO_WORK_CERT_TYPE } from "./certifications";
import { CLASS_REQUIREMENT_CATALOG } from "./class-requirement-catalog";

describe("CLASS_REQUIREMENT_CATALOG", () => {
  it("offers Ready to Work under the certType the app stores on Certification rows", () => {
    const readyToWork = CLASS_REQUIREMENT_CATALOG.find(
      (item) => item.itemId === READY_TO_WORK_CERT_TYPE,
    );
    assert.ok(readyToWork, "Ready to Work must be addable to a class requirement matrix");
    assert.equal(readyToWork.itemType, "certification");
    assert.equal(readyToWork.title, "Ready to Work");
  });

  it("lists each item once", () => {
    const keys = CLASS_REQUIREMENT_CATALOG.map((item) => `${item.itemType}:${item.itemId}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});
