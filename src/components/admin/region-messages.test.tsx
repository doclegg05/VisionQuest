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

  it("is not shown an API path", () => {
    assert.equal(page.includes("/api/admin/regions"), false);
    assert.equal(page.includes("once it ships"), false);
  });
});

// ClassRosterManager loads its data in an effect, so a static render stops at
// "Loading classes...". This reads its source for the wiring the e2e spec walks.
describe("class settings", () => {
  const manager = sourceOf("../teacher/ClassRosterManager.tsx");

  it("sends the picked region in the save-settings body only", () => {
    const sends = manager.split("regionPatchFor(").length - 1;
    assert.equal(sends, 1, "one use: saveClassSettings");
    const saveSettings = manager.slice(manager.indexOf("async function saveClassSettings"), manager.indexOf("async function updateClassStatus"));
    assert.ok(saveSettings.includes("regionPatchFor("));
  });

  it("shows the region field in the class settings block", () => {
    const settings = manager.slice(manager.indexOf("onChange={(event) => setClassCode("), manager.indexOf("setClassStartDate(event"));
    assert.ok(settings.includes("<ClassRegionField"));
  });

  it("ties a pick to the class it was made for", () => {
    assert.ok(manager.includes("regionChoiceFor(regionChoice, selectedClassId)"));
    assert.ok(manager.includes("setRegionChoice({ classId: selectedClassId, regionId })"));
  });
});
