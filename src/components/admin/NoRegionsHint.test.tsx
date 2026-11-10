import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { NoRegionsHint } from "./NoRegionsHint";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "").replaceAll("<!-- -->", "");
}

describe("NoRegionsHint", () => {
  const html = renderToString(<NoRegionsHint />);

  it("says why there is nothing to pick, and what to do first", () => {
    assert.equal(text(html), "No regions yet. Add one in the Regions card at the top of this page first.");
  });

  it("links the words Regions card to the card", () => {
    assert.match(html, /<a href="#regions"[^>]*>Regions card<\/a>/);
  });
});
