import { test } from "node:test";
import assert from "node:assert/strict";

import { STAFF_ITEMS } from "./NavBar";

/**
 * The first three entries are the teacher mobile nav slots — everything past
 * index 2 is desktop-sidebar-only. Ordering here is a product decision, so
 * these tests pin the intent behind it rather than a literal array, which
 * would red on every deliberate reshuffle.
 */
const MOBILE_SLOT_COUNT = 3;

test("teacher mobile slots lead with the roster, not the AI coach", () => {
  const mobile = STAFF_ITEMS.slice(0, MOBILE_SLOT_COUNT).map((item) => item.href);

  assert.deepEqual(mobile, ["/teacher", "/teacher/classes", "/teacher/library"]);
  assert.equal(
    mobile[0],
    "/teacher",
    "a teacher's first tap is their students, not a chat surface"
  );
});

test("AI Review stays available but out of the mobile slots", () => {
  // PR #128 added failed-extractions review and deliberately de-emphasised it:
  // it is a triage queue, not daily work. The 2026-09-03 nav reshuffle moved it
  // off the end, so pin that intent (present, reachable, not promoted) instead
  // of its index.
  const review = STAFF_ITEMS.find((item) => item.href === "/teacher/failed-extractions");

  assert.ok(review, "AI Review must remain reachable from staff nav");
  assert.equal(review.phase, 1);
  assert.ok(review.icon, "entry must carry an icon");
  assert.ok(
    STAFF_ITEMS.indexOf(review) >= MOBILE_SLOT_COUNT,
    "AI Review must not occupy a teacher mobile slot"
  );
});

test("staff nav labels stay short enough to read in a sidebar", () => {
  for (const item of STAFF_ITEMS) {
    assert.ok(
      item.label.split(" ").length <= 3,
      `nav label "${item.label}" (${item.href}) should be 1-3 plain words`
    );
    assert.ok(item.icon, `${item.href} must carry an icon`);
    assert.equal(item.phase, 1, `${item.href} must be phase 1`);
  }
});
