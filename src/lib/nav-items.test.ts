import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STUDENT_NAV_ITEMS,
  getVisibleNavItems,
} from "./nav-items";

describe("STUDENT_NAV_ITEMS (Phase 6: Sage promoted to primary nav)", () => {
  it("includes Sage as a phase-1 primary nav item", () => {
    const sage = STUDENT_NAV_ITEMS.find((item) => item.href === "/chat");
    assert.ok(sage, "Sage entry missing from STUDENT_NAV_ITEMS");
    assert.equal(sage?.phase, 1);
    assert.equal(sage?.label, "Sage");
  });

  it("puts Sage right after Home so it's the second item on the sidebar", () => {
    assert.equal(STUDENT_NAV_ITEMS[0]?.href, "/dashboard");
    assert.equal(STUDENT_NAV_ITEMS[1]?.href, "/chat");
  });

  it("exposes Sage to a brand-new phase-1 student", () => {
    const visible = getVisibleNavItems(1);
    assert.ok(visible.some((item) => item.href === "/chat"));
  });

  it("still hides orientation for phase-1 students once marked complete", () => {
    const visible = getVisibleNavItems(1, true);
    assert.ok(!visible.some((item) => item.href === "/orientation"));
    assert.ok(visible.some((item) => item.href === "/chat"));
  });
});
