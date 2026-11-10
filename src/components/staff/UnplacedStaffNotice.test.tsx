import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { renderToString } from "react-dom/server";

let UnplacedStaffNotice: typeof import("./UnplacedStaffNotice").UnplacedStaffNotice;
before(async () => {
  ({ UnplacedStaffNotice } = await import("./UnplacedStaffNotice"));
});

function render(): string {
  return renderToString(<UnplacedStaffNotice />).replaceAll("<!-- -->", "");
}

describe("UnplacedStaffNotice", () => {
  it("sends the instructor to their program admin, and says where the admin does it", () => {
    const html = render();
    assert.ok(
      html.includes(
        "Ask your program admin to add you to a region and a class. They do this on the Admin page, under Staff Waiting for a Region.",
      ),
    );
  });

  it("no longer sends the instructor to a coordinator for an invite", () => {
    const html = render();
    assert.doesNotMatch(html, /coordinator/i);
    assert.doesNotMatch(html, /invite/i);
  });

  it("names the heading the admin will really see on the Admin page", async () => {
    const { OrgPlacementPanel } = await import("./OrgPlacementPanel");
    const panel = renderToString(
      <OrgPlacementPanel unplacedStaff={[]} applicants={[]} unregionedClasses={[]} regions={[]} classes={[]} canPlace={true} />,
    );
    assert.ok(panel.includes("Staff Waiting for a Region"));
  });

  it("uses no dash characters", () => {
    assert.doesNotMatch(render(), /[–—]/);
  });
});
