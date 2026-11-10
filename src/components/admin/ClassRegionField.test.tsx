import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { ClassRegionField } from "./ClassRegionField";

const regions = [
  { id: "r1", name: "North" },
  { id: "r2", name: "East" },
];

function render(value: string, list: readonly { id: string; name: string }[] = regions): string {
  return renderToString(<ClassRegionField regions={list} value={value} onChange={() => {}} />);
}

describe("ClassRegionField", () => {
  it("labels the select", () => {
    const html = render("");
    assert.ok(html.includes('<label for="class-settings-region"'));
    assert.ok(html.includes('<select id="class-settings-region"'));
    assert.ok(html.includes(">Region</label>"));
  });

  it("starts on keeping the current region, so a save does not move the class", () => {
    const html = render("");
    const first = html.slice(html.indexOf("<option"), html.indexOf("</option>"));
    assert.ok(first.includes('value=""'));
    assert.ok(first.includes("Keep the current region"));
    assert.ok(first.includes("selected"));
  });

  it("offers each region the class can move to", () => {
    const html = render("r2");
    assert.ok(html.includes(">North</option>"));
    assert.match(html, /<option value="r2" selected="">East<\/option>/);
  });

  it("says how to save the move", () => {
    assert.ok(render("").includes("To move this class, pick a region. Then press Save Settings."));
  });

  it("is at least 44px tall", () => {
    assert.match(render(""), /<select[^>]*\bmin-h-11\b/);
  });

  it("is left out when there is no region to pick", () => {
    assert.equal(render("", []), "");
  });
});
