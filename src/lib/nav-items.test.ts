import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STUDENT_NAV_ITEMS,
  STUDENT_SECONDARY_NAV,
  getVisibleNavItems,
} from "./nav-items";

describe("STUDENT_NAV_ITEMS", () => {
  it("keeps Sage and Orientation out of primary student nav", () => {
    assert.ok(!STUDENT_NAV_ITEMS.some((item) => item.href === "/chat"));
    assert.ok(!STUDENT_NAV_ITEMS.some((item) => item.href === "/orientation"));
  });

  it("starts with Home and Goals for the core student flow", () => {
    assert.equal(STUDENT_NAV_ITEMS[0]?.href, "/dashboard");
    assert.equal(STUDENT_NAV_ITEMS[1]?.href, "/goals");
  });

  it("exposes retained features as secondary nav items", () => {
    const hrefs = STUDENT_SECONDARY_NAV.map((item) => item.href);
    assert.deepEqual(hrefs, ["/vision-board", "/files", "/resources"]);
  });

  it("does not expose orientation after completion because it is not a primary nav item", () => {
    const visible = getVisibleNavItems(1);
    assert.ok(!visible.some((item) => item.href === "/orientation"));
  });
});
