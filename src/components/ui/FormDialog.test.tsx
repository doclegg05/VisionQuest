import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { FormDialog, closeIntent } from "./FormDialog";

/**
 * Teacher modal forms closed on any backdrop tap and threw away what was
 * typed, with no dialog semantics, Escape, or focus containment (HIG review
 * D-27). FormDialog is a <dialog> opened with showModal(), labelled by its
 * heading, that asks before discarding a dirty form.
 */

describe("FormDialog", () => {
  const html = renderToString(
    <FormDialog title="Quick task for Sam" dirty={false} onClose={() => {}}>
      <p>body</p>
    </FormDialog>,
  );

  it("is a native dialog labelled by its heading", () => {
    const dialog = html.match(/<dialog[^>]*>/)?.[0];
    assert.ok(dialog, "expected a <dialog>");
    const labelledBy = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(labelledBy, "expected aria-labelledby");
    assert.match(html, new RegExp(`<h2[^>]*id="${labelledBy.replace(/[:]/g, "\\$&")}"[^>]*>Quick task for Sam</h2>`));
  });

  it("renders its children", () => {
    assert.match(html, /<p>body<\/p>/);
  });
});

describe("closeIntent", () => {
  it("closes a clean form at once", () => {
    assert.equal(closeIntent(false), "close");
  });

  it("asks before discarding a dirty form", () => {
    assert.equal(closeIntent(true), "confirm-discard");
  });
});
