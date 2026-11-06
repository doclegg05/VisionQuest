import { test } from "node:test";
import assert from "node:assert/strict";

import { getVisibleNavItems, getVisibleSecondaryNavItems } from "@/lib/nav-items";
import { ADMIN_NAV_ITEMS, COORDINATOR_ITEMS, staffPrimaryNavItemsFor } from "./NavBar";

// The (teacher) layout admits only teacher and admin, so every /teacher/*
// href redirects a coordinator away. /coordinator is the one surface their
// role can open.
const COORDINATOR_OPENABLE = [/^\/coordinator(\/|$)/];

test("coordinator nav offers only routes the coordinator role can open", () => {
  for (const item of COORDINATOR_ITEMS) {
    assert.ok(
      COORDINATOR_OPENABLE.some((re) => re.test(item.href)),
      `${item.href} redirects a coordinator`,
    );
  }
});

// Owner decision, 2026-11-06: both coordinator roles may use Sage chat, so
// the coordinator nav gains a Sage entry beside the workspace.
test("coordinator nav is the Coordinator entry and Sage", () => {
  assert.deepEqual(
    COORDINATOR_ITEMS.map((item) => `${item.href}|${item.label}`),
    ["/coordinator|Coordinator", "/coordinator/chat|Sage"],
  );
});

test("students never see the coordinator Sage entry", () => {
  for (const phase of [1, 2, 3] as const) {
    for (const complete of [false, true]) {
      const hrefs = [
        ...getVisibleNavItems(phase, complete),
        ...getVisibleSecondaryNavItems(phase, complete),
      ].map((item) => item.href);
      assert.ok(!hrefs.some((href) => href.startsWith("/coordinator")), `phase ${phase}`);
    }
  }
});

test("admin nav is unchanged by the coordinator list", () => {
  assert.deepEqual(
    ADMIN_NAV_ITEMS.map((item) => `${item.href}|${item.label}`),
    [
      "/admin/chat|Sage",
      "/admin|Admin",
      "/admin/library|Library",
      "/teacher/admin/benchmarks|Benchmarks",
      "/teacher|Students & Classes",
      "/coordinator|Coordinator",
      "/teacher/classes|Classes",
      "/teacher/connect|Connect",
      "/teacher/manage|Program Setup",
      "/teacher/failed-extractions|AI Review",
    ],
  );
});

test("both coordinator roles get the coordinator nav, not the instructor nav", () => {
  assert.equal(staffPrimaryNavItemsFor("program_coordinator"), COORDINATOR_ITEMS);
  assert.equal(staffPrimaryNavItemsFor("coordinator"), COORDINATOR_ITEMS);
  assert.equal(staffPrimaryNavItemsFor("admin"), ADMIN_NAV_ITEMS);
});
