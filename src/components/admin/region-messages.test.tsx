import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";

// The panel's controls call useRouter(), which needs a mounted app router.
mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});

let OrgPlacementPanel: typeof import("@/components/staff/OrgPlacementPanel").OrgPlacementPanel;
before(async () => {
  ({ OrgPlacementPanel } = await import("@/components/staff/OrgPlacementPanel"));
});

const unregioned = [{ id: "c1", name: "Morning Class", instructorCount: 1, activeStudents: 3 }];

function renderPanel(canPlace: boolean): string {
  return renderToString(
    <OrgPlacementPanel unplacedStaff={[]} applicants={[]} unregionedClasses={unregioned} regions={[]} classes={[]} canPlace={canPlace} />,
  );
}

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("classrooms with no region", () => {
  it("no longer points at a class edit screen that has no region field", () => {
    assert.equal(renderPanel(true).includes("class edit screen"), false);
  });

  it("tells an admin which control fixes it", () => {
    const html = renderPanel(true);
    assert.ok(html.includes("Class Roster"), "names the section that holds the control");
    assert.ok(html.includes("Save Settings"), "names the button that saves it");
  });

  it("tells anyone else to ask an admin, because only an admin sees that control", () => {
    const html = renderPanel(false);
    assert.ok(html.includes("Ask an admin"));
    assert.equal(html.includes("Save Settings"), false);
  });
});

// The coordinator page is an async server component that reads the session
// and the database, so it cannot be rendered here. This reads its source.
describe("a coordinator with no region", () => {
  const page = sourceOf("../../app/(coordinator)/coordinator/page.tsx");

  it("is told to ask their program admin", () => {
    assert.ok(page.includes("Ask your program admin to add you to a region."));
  });

  it("is told, when they see the whole state, to add a region on the Admin page", () => {
    assert.ok(page.includes("There are no regions yet. Add one on the"));
    assert.match(page, /href="\/admin#regions"[^>]*>Admin page</);
  });

  it("reads an intro with no dash and no jargon", () => {
    assert.ok(page.includes("See how your regions are doing. Track grant goals and instructors. Download reports for funders."));
    assert.equal(page.includes("rollups"), false);
    assert.equal(page.includes("funder-ready"), false);
    assert.equal(page.includes("\u2014"), false);
  });

  it("is not shown an API path", () => {
    assert.equal(page.includes("/api/admin/regions"), false);
    assert.equal(page.includes("once it ships"), false);
  });
});

// A region change used to remount the cards below it and erase what was typed,
// including a new student's one-time password. The page must not key them.
describe("the admin page", () => {
  const adminPage = sourceOf("../../app/(admin)/admin/page.tsx");
  const card = sourceOf("./RegionsCard.tsx");
  const manager = sourceOf("../teacher/ClassRosterManager.tsx");

  it("does not remount its cards when a region changes", () => {
    assert.equal(adminPage.includes("regionsKey"), false);
    assert.equal(/<div key=/.test(adminPage), false);
  });

  it("has the Regions card announce each saved change", () => {
    assert.ok(card.includes("announceRegionsChanged("));
  });

  it("has the class card reload its regions on that signal", () => {
    assert.ok(manager.includes("useRegionsChanged("));
  });
});

// ClassRosterManager loads its data in an effect, so a static render stops at
// "Loading classes...". This reads its source for the wiring the e2e spec walks.
describe("class settings", () => {
  const manager = sourceOf("../teacher/ClassRosterManager.tsx");
  const adminPage = sourceOf("../../app/(admin)/admin/page.tsx");
  const teacherPage = sourceOf("../../app/(teacher)/teacher/classes/page.tsx");

  it("sends the region move in the save-settings body only", () => {
    const saveSettings = manager.slice(manager.indexOf("async function saveClassSettings"), manager.indexOf("async function updateClassStatus"));
    assert.ok(saveSettings.includes("regionMove.patch()"));
    assert.equal(manager.split("regionMove.patch()").length - 1, 1, "one use: saveClassSettings");
  });

  it("asks before a move, before anything is sent", () => {
    const saveSettings = manager.slice(manager.indexOf("async function saveClassSettings"), manager.indexOf("async function updateClassStatus"));
    assert.ok(saveSettings.indexOf("regionMove.confirmMove()") < saveSettings.indexOf("fetch("));
    assert.ok(manager.includes("{regionMove.confirmDialog}"));
  });

  it("shows the Region select only when the page manages regions", () => {
    assert.match(manager, /\{manageRegions \? <ClassRegionField /);
  });

  it("shows the class's region in the header", () => {
    assert.ok(manager.includes("<ClassRegionLine region={classDetail.region} />"));
  });

  it("is told it manages regions by the admin page, and only there", () => {
    assert.ok(adminPage.includes("<ClassRosterManager manageRegions />"));
    assert.equal(teacherPage.includes("manageRegions"), false);
  });
});
