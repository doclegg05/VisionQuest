import { test } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_NAV_ITEMS, COORDINATOR_ITEMS } from "./NavBar";

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

test("coordinator nav is exactly the Coordinator entry", () => {
  assert.deepEqual(
    COORDINATOR_ITEMS.map((item) => item.href),
    ["/coordinator"],
  );
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
