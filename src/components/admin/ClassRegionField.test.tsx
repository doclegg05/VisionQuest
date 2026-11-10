import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { ClassRegionField, ClassRegionLine } from "./ClassRegionField";

const north = { id: "r1", name: "North" };
const east = { id: "r2", name: "East" };

function render(value: string, current: { id: string; name: string } | null, list = [north, east]): string {
  return renderToString(<ClassRegionField regions={list} currentRegion={current} value={value} onChange={() => {}} />);
}

describe("ClassRegionField", () => {
  it("labels the select", () => {
    const html = render("r1", north);
    assert.ok(html.includes('<label for="class-settings-region"'));
    assert.ok(html.includes('<select id="class-settings-region"'));
    assert.ok(html.includes(">Region</label>"));
  });

  it("starts on the class's current region, with no keep option", () => {
    const html = render("r1", north);
    assert.match(html, /<option value="r1" selected="">North<\/option>/);
    assert.equal(html.includes("Keep the current region"), false);
    assert.equal(html.includes('value=""'), false);
  });

  it("offers a placeholder only when the class has no region yet", () => {
    const html = render("", null);
    assert.match(html, /<option value="" selected="">Pick a region<\/option>/);
  });

  it("still shows the current region when it is not one this person may pick", () => {
    const html = render("r9", { id: "r9", name: "Old Valley" });
    assert.match(html, /<option value="r9" selected="">Old Valley<\/option>/);
  });

  it("says how to save the move", () => {
    assert.ok(render("r1", north).includes("To move this class, pick a region. Then press Save Settings."));
  });

  it("is at least 44px tall", () => {
    assert.match(render("r1", north), /<select[^>]*\bmin-h-11\b/);
  });
});

describe("ClassRegionLine", () => {
  it("names the class's region", () => {
    assert.equal(renderToString(<ClassRegionLine region={north} />).replaceAll("<!-- -->", "").replace(/<[^>]+>/g, ""), "Region: North");
  });

  it("says when the class has none", () => {
    assert.equal(renderToString(<ClassRegionLine region={null} />).replaceAll("<!-- -->", "").replace(/<[^>]+>/g, ""), "Region: None yet");
  });
});
