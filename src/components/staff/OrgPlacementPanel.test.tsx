import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { OrgPlacementPanel } from "./OrgPlacementPanel";

const applicants = [{ id: "s1", displayName: "Sam Applicant", county: "Kanawha", createdOn: "Jan 2, 2026" }];
const classes = [{ id: "c1", name: "Morning Class" }];

function render(canPlace: boolean): string {
  return renderToString(
    <OrgPlacementPanel unplacedStaff={[]} applicants={applicants} unregionedClasses={[]} regions={[]} classes={classes} canPlace={canPlace} />,
  );
}

describe("OrgPlacementPanel applicants", () => {
  it("shows the Place in a classroom control to an admin", () => {
    const html = render(true);
    assert.ok(html.includes("Place in a classroom"));
    assert.ok(html.includes("Morning Class"));
  });

  it("shows the list read-only, with no control, to anyone else", () => {
    const html = render(false);
    assert.ok(html.includes("Sam Applicant"));
    assert.ok(!html.includes("Place in a classroom"));
    assert.ok(!html.includes("Morning Class"));
  });
});

describe("OrgPlacementPanel classrooms with no region", () => {
  it("lists them read-only under a plain heading", () => {
    const html = renderToString(
      <OrgPlacementPanel
        unplacedStaff={[]}
        applicants={[]}
        regions={[]}
        classes={[]}
        canPlace={true}
        unregionedClasses={[{ id: "k1", name: "Night Class", instructorCount: 2, activeStudents: 7 }]}
      />,
    );
    assert.ok(html.includes("Classrooms with no region"));
    assert.ok(html.includes("Night Class"));
    assert.ok(html.includes("2 instructors"));
    assert.ok(html.includes("7 students"));
  });

  it("says so when every classroom has a region", () => {
    const html = renderToString(
      <OrgPlacementPanel unplacedStaff={[]} applicants={[]} regions={[]} classes={[]} canPlace={true} unregionedClasses={[]} />,
    );
    assert.ok(html.includes("Classrooms with no region"));
    assert.ok(html.includes("Every classroom has a region."));
  });
});
