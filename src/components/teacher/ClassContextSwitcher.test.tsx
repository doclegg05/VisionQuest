import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveInitialClassId,
  shouldRenderSwitcher,
} from "./ClassContextSwitcher";

describe("shouldRenderSwitcher", () => {
  it("hides for teachers with no managed classes", () => {
    assert.equal(shouldRenderSwitcher(0), false);
  });

  it("hides for single-class teachers", () => {
    assert.equal(shouldRenderSwitcher(1), false);
  });

  it("renders once a teacher manages two classes", () => {
    assert.equal(shouldRenderSwitcher(2), true);
  });

  it("renders for larger cohorts", () => {
    assert.equal(shouldRenderSwitcher(11), true);
  });
});

describe("resolveInitialClassId", () => {
  const known = ["cls_a", "cls_b", "cls_c"];

  it("prefers the URL parameter when it matches a managed class", () => {
    assert.equal(resolveInitialClassId("cls_b", "cls_a", known), "cls_b");
  });

  it("falls back to localStorage when the URL is empty", () => {
    assert.equal(resolveInitialClassId(null, "cls_c", known), "cls_c");
  });

  it("returns 'all' when neither source matches a managed class", () => {
    assert.equal(resolveInitialClassId("cls_zz", "cls_zz", known), "all");
  });

  it("returns 'all' when nothing is set", () => {
    assert.equal(resolveInitialClassId(null, null, known), "all");
  });

  it("ignores a stored value that is no longer a managed class", () => {
    assert.equal(resolveInitialClassId(null, "cls_stale", known), "all");
  });

  it("URL trumps even a valid stored value", () => {
    assert.equal(resolveInitialClassId("cls_a", "cls_c", known), "cls_a");
  });
});
