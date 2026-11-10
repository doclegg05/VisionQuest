import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { CreateClassRegionSelect } from "./CreateClassRegionSelect";

const regions = [
  { id: "r1", name: "North" },
  { id: "r2", name: "East" },
];

function render(list: readonly { id: string; name: string }[], onAdminPage = true, value = ""): string {
  return renderToString(
    <CreateClassRegionSelect regions={list} value={value} onChange={() => {}} onAdminPage={onAdminPage} />,
  ).replaceAll("<!-- -->", "");
}

describe("the Region select in Create a Class", () => {
  it("offers each region under a label", () => {
    const html = render(regions, true, "r2");
    assert.match(html, /<label for="new-class-region"[^>]*>Region<\/label>/);
    assert.match(html, /<select id="new-class-region"[^>]*min-h-11/);
    assert.match(html, /<option value="r2" selected="">East<\/option>/);
  });

  it("on an empty system shows why, in place of an empty select", () => {
    const html = render([]);
    assert.equal(html.includes("<select"), false);
    assert.ok(html.includes("No regions yet. Add one in the "));
    assert.ok(html.includes('href="#regions"'));
  });

  it("does not send an instructor to a Regions card that is not on their page", () => {
    const html = render([], false);
    assert.equal(html.includes("<select"), false);
    assert.equal(html.includes('href="#regions"'), false);
    assert.ok(html.includes("Ask your program admin"));
  });
});
