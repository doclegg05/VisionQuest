import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { StaffInvitePanel } from "./StaffInvitePanel";

const regions = [
  { id: "r1", name: "North" },
  { id: "r2", name: "East" },
];

function render(list: readonly { id: string; name: string }[], roles: readonly string[] = ["coordinator", "teacher"]): string {
  return renderToString(<StaffInvitePanel roles={roles} regions={list} />).replaceAll("<!-- -->", "");
}

describe("StaffInvitePanel", () => {
  it("can be linked to as #invite-staff", () => {
    assert.match(render(regions), /<section id="invite-staff"/);
  });

  it("picks the first region to start with", () => {
    assert.match(render(regions), /<option value="r1" selected="">North<\/option>/);
  });

  it("on an empty system shows why there is no region to pick", () => {
    const html = render([]);
    assert.equal(html.includes('id="invite-region"'), false);
    assert.ok(html.includes("No regions yet. Add one in the "));
    assert.ok(html.includes('href="#regions"'));
  });

  it("asks for no region when the role needs none", () => {
    const html = render([], ["program_coordinator"]);
    assert.equal(html.includes("No regions yet"), false);
  });
});
