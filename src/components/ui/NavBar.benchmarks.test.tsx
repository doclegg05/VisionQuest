import { test } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_ITEMS, STAFF_ITEMS } from "./NavBar";

const BENCHMARKS_HREF = "/teacher/admin/benchmarks";

test("the benchmark dashboard is advertised only in the admin nav", () => {
  const admin = ADMIN_ITEMS.find((item) => item.href === BENCHMARKS_HREF);
  assert.ok(admin, "ADMIN_ITEMS must carry the benchmarks entry");
  assert.equal(admin.label, "Benchmarks");
  assert.ok(admin.icon, "entry must carry an icon");
  assert.equal(admin.phase, 1);

  // STAFF_ITEMS is what a plain teacher's sidebar renders. The page itself
  // 404s for a teacher, so a link here would only ever be a dead end.
  assert.ok(
    !STAFF_ITEMS.some((item) => item.href === BENCHMARKS_HREF),
    "a teacher must never be offered a link to an admin-only page",
  );
});

test("admin nav labels stay one or two plain words", () => {
  for (const item of ADMIN_ITEMS) {
    assert.ok(item.label.split(" ").length <= 2, item.label);
  }
});
