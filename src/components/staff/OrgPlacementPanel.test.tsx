import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// PlaceApplicantControl calls useRouter(), which needs a mounted app router.
// Static rendering has none, so stand in a router.
mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});

let OrgPlacementPanel: typeof import("./OrgPlacementPanel").OrgPlacementPanel;
before(async () => {
  ({ OrgPlacementPanel } = await import("./OrgPlacementPanel"));
});

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

describe("OrgPlacementPanel staff waiting for a region", () => {
  const person = { id: "t1", displayName: "Tia Teacher", createdOn: "Jan 2, 2026" };

  it("on an empty system shows why, in place of an empty Region select", () => {
    const html = renderToString(
      <OrgPlacementPanel unplacedStaff={[person]} applicants={[]} unregionedClasses={[]} regions={[]} classes={[]} canPlace={true} />,
    ).replaceAll("<!-- -->", "");
    assert.equal(html.includes('id="region-for-t1"'), false);
    assert.ok(html.includes("No regions yet. Add one in the "));
    assert.ok(html.includes('href="#regions"'));
  });

  it("picks the first region to start with", () => {
    const html = renderToString(
      <OrgPlacementPanel
        unplacedStaff={[person]}
        applicants={[]}
        unregionedClasses={[]}
        regions={[{ id: "r1", name: "North" }]}
        classes={[]}
        canPlace={true}
      />,
    );
    assert.match(html, /<option value="r1" selected="">North<\/option>/);
  });
});

describe("OrgPlacementPanel classes with no region", () => {
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
    assert.ok(html.includes("Classes with No Region"));
    assert.ok(html.includes("Night Class"));
    assert.ok(html.includes("2 instructors"));
    assert.ok(html.includes("7 students"));
  });

  it("says so when every classroom has a region", () => {
    const html = renderToString(
      <OrgPlacementPanel unplacedStaff={[]} applicants={[]} regions={[]} classes={[]} canPlace={true} unregionedClasses={[]} />,
    );
    assert.ok(html.includes("Classes with No Region"));
    assert.ok(html.includes("Every class has a region."));
  });
});

describe("OrgPlacementPanel words", () => {
  const unregioned = [{ id: "k1", name: "Night Class", instructorCount: 1, activeStudents: 1 }];

  it("tells an admin each step that puts a class in a region", () => {
    const html = renderToString(
      <OrgPlacementPanel unplacedStaff={[]} applicants={[]} regions={[]} classes={[]} canPlace={true} unregionedClasses={unregioned} />,
    ).replaceAll("&#x27;", "'");
    assert.ok(
      html.includes(
        "Regional coordinators can't see these classes. To fix one, go to Class Roster on this page. Choose the class under Select class. Choose a region, then press Save Settings.",
      ),
    );
  });

  it("says classes, not classrooms, in its own words", () => {
    // With canPlace, each applicant row carries PlaceApplicantControl, whose
    // own words are outside this panel; so applicants are listed read-only here.
    for (const canPlace of [true, false]) {
      const html = renderToString(
        <OrgPlacementPanel
          unplacedStaff={[]}
          applicants={canPlace ? [] : applicants}
          regions={[]}
          classes={[]}
          canPlace={canPlace}
          unregionedClasses={unregioned}
        />,
      );
      assert.doesNotMatch(html, /classroom/i);
    }
  });
});
