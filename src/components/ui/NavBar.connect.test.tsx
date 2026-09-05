import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { PLATFORM_MAP } from "@/lib/sage/platform-map";

/**
 * "Connect" in the teacher nav (Task 3.4).
 *
 * The #176 precedent is the reason this test exists: a staff page that is not
 * in the nav is a page nobody finds, and #176 shipped copy for a settings
 * screen teachers could not reach. NavBar renders its staff nav from ONE array
 * — sidebar, the mobile main row, the mobile More sheet, and the admin merge
 * all read `STAFF_ITEMS` — so the invariant to pin is that the entry is in
 * that array and that the admin merge does not filter it out, not that four
 * separate lists agree.
 */

const SOURCE = readFileSync(path.join(process.cwd(), "src/components/ui/NavBar.tsx"), "utf8");

describe("teacher nav — Connect", () => {
  it("is in STAFF_ITEMS, the single source for all four nav variants", () => {
    const staffItems = SOURCE.slice(
      SOURCE.indexOf("export const STAFF_ITEMS"),
      SOURCE.indexOf("const COORDINATOR_ITEMS"),
    );
    assert.ok(staffItems.includes('href: "/teacher/connect"'), staffItems);
    assert.ok(staffItems.includes('label: "Connect"'), staffItems);
  });

  it("survives the admin merge, which only drops Sage and Library", () => {
    // The admin sidebar rebuilds its list from STAFF_ITEMS minus the two
    // entries admins have their own version of. Connect must not join that
    // filter by accident.
    const filterClause = SOURCE.slice(
      SOURCE.indexOf("STAFF_ITEMS.filter("),
      SOURCE.indexOf("STAFF_ITEMS.filter(") + 260,
    );
    assert.ok(!filterClause.includes("/teacher/connect"), filterClause);
  });

  it("is in the platform map, so Sage can route an instructor to it", () => {
    const entry = PLATFORM_MAP.find((feature) => feature.route === "/teacher/connect");
    assert.ok(entry, "no PLATFORM_MAP entry for /teacher/connect");
    assert.deepEqual(entry.roles, ["teacher"]);
    assert.ok(entry.compact, "the compact tier is what a local model sees");
    assert.ok(
      entry.summary.toLowerCase().includes("connect"),
      "the summary should name the nav label the instructor is looking for",
    );
  });

  it("names its nav label in the map, so 'where is Connect' resolves", () => {
    const entry = PLATFORM_MAP.find((feature) => feature.route === "/teacher/connect");
    assert.ok(entry?.summary.includes("Listed in the teacher nav as Connect"), entry?.summary);
  });
});
