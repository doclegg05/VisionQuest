import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siblingScoreDelta } from "./form-sibling-rules";

describe("siblingScoreDelta", () => {
  it("boosts attendance-contract and demotes sign-in for promise-to-attend", () => {
    const q = "What form do I sign to promise I will come to class every day?";
    assert.ok(siblingScoreDelta(q, "attendance-contract") > 0);
    assert.ok(siblingScoreDelta(q, "sign-in-sheet") < 0);
    assert.ok(siblingScoreDelta(q, "rtw-attendance") < 0);
  });

  it("boosts dohs-release over auth-release for DoHS share asks", () => {
    const q =
      "I need to sign the form that lets the Department of Health Services share my information";
    assert.ok(siblingScoreDelta(q, "dohs-release") > 0);
    assert.ok(siblingScoreDelta(q, "auth-release") < 0);
  });

  it("returns 0 when no rule matches", () => {
    assert.equal(siblingScoreDelta("hello how are you", "student-profile"), 0);
  });
});
