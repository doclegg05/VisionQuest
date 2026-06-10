import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STUDENT_NAV_ITEMS,
  STUDENT_SECONDARY_NAV,
  getVisibleNavItems,
  getVisibleSecondaryNavItems,
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

  it("exposes consolidated secondary nav items (Phase 4 chat-first redesign)", () => {
    const hrefs = STUDENT_SECONDARY_NAV.map((item) => item.href);
    // Resources merged into Learning; Files presented as "Documents".
    assert.deepEqual(hrefs, ["/vision-board", "/files"]);
  });

  it("adds the orientation archive to secondary nav only after completion", () => {
    const before = getVisibleSecondaryNavItems(3, false).map((item) => item.href);
    assert.ok(!before.includes("/orientation"));
    const after = getVisibleSecondaryNavItems(3, true).map((item) => item.href);
    assert.ok(after.includes("/orientation"));
  });

  it("does not expose orientation after completion because it is not a primary nav item", () => {
    const visible = getVisibleNavItems(1);
    assert.ok(!visible.some((item) => item.href === "/orientation"));
  });
});
