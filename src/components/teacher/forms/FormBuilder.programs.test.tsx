import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import FormBuilder from "./FormBuilder";

/**
 * HIG review g10 round 1: the "Programs" group was a <label> wrapping three
 * checkbox <label>s. Nested labels are invalid HTML and gave the first
 * checkbox a garbled name; the captions were raw enum values.
 */
describe("FormBuilder programs group", () => {
  const html = renderToString(<FormBuilder mode="new" onClose={() => {}} onSaved={() => {}} />);

  it("is a fieldset named by a Programs legend", () => {
    assert.match(html, /<fieldset[^>]*>\s*<legend[^>]*>Programs<\/legend>/);
  });

  it("nests no label inside another label", () => {
    const labels = html.match(/<\/?label\b/g) ?? [];
    let depth = 0;
    for (const tag of labels) {
      depth += tag === "<label" ? 1 : -1;
      assert.ok(depth <= 1, "found a <label> opened inside another <label>");
    }
  });

  it("captions each checkbox with the program name, not its enum value", () => {
    for (const name of ["SPOKES", "Adult Education", "IETP"]) {
      assert.match(html, new RegExp(`/>${name}</label>`));
    }
    assert.doesNotMatch(html, />(spokes|adult_ed|ietp)</);
  });

  it("describes the group with the leave-empty hint", () => {
    const describedBy = html.match(/<fieldset[^>]*aria-describedby="([^"]+)"/)?.[1];
    assert.ok(describedBy, "expected aria-describedby on the fieldset");
    assert.match(html, new RegExp(`id="${describedBy.replace(/[:]/g, "\\$&")}"[^>]*>Leave empty to show to all programs.<`));
  });
});
