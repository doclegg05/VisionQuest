import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import OrientationFormDetail from "./OrientationFormDetail";

// The checklist card picks its action from the form catalog. The Student
// Profile is flagged requiresSignature, but the wizard completes it in the
// browser (a `profile-form` step), so a signature pad on this card would post
// a submission holding only the signature image and no profile.

function visibleText(itemLabel: string): string {
  const html = renderToStaticMarkup(<OrientationFormDetail itemLabel={itemLabel} />);
  return html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
}

describe("OrientationFormDetail submission action", () => {
  it("offers a signature pad on a form completed by signing", () => {
    assert.match(visibleText("Sign Personal Attendance Contract"), /Sign &amp; Submit/);
  });

  it("does not offer a signature pad on the Student Profile", () => {
    const text = visibleText("Complete SPOKES Student Profile");
    assert.doesNotMatch(text, /Sign &amp; Submit/);
    assert.match(text, /Upload Form/);
  });

  it("still labels the Student Profile as a signature form", () => {
    assert.match(visibleText("Complete SPOKES Student Profile"), /\|Signature\|/);
  });
});
