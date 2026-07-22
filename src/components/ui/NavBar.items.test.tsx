import { test } from "node:test";
import assert from "node:assert/strict";

import { STAFF_ITEMS } from "./NavBar";

test("staff nav ends with the failed-extractions review entry", () => {
  const last = STAFF_ITEMS[STAFF_ITEMS.length - 1];
  assert.equal(last.href, "/teacher/failed-extractions");
  assert.equal(last.phase, 1);
  assert.ok(last.icon, "entry must carry an icon");
  assert.ok(
    last.label.split(" ").length <= 2,
    "nav labels are 1-2 plain words"
  );
});

test("teacher mobile nav slots are unchanged (first three entries)", () => {
  assert.deepEqual(
    STAFF_ITEMS.slice(0, 3).map((item) => item.href),
    ["/teacher/chat", "/teacher", "/teacher/classes"]
  );
});
