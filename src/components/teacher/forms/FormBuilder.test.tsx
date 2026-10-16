import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import FormBuilder, { builderDirty, type BuilderSnapshot } from "./FormBuilder";
import { ReviewDrawer } from "./FormResponsesReview";

/**
 * HIG review D-27: the form builder and the response review drawer closed on
 * any backdrop tap, threw away what the teacher typed, and had no dialog
 * semantics. Both now sit on FormDialog, which asks before discarding.
 */

function escapeId(id: string): string {
  return id.replace(/[:]/g, "\\$&");
}

function assertLabelledDialog(html: string, title: string): void {
  const dialog = html.match(/<dialog[^>]*>/)?.[0];
  assert.ok(dialog, "expected a <dialog>");
  const labelledBy = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelledBy, "expected aria-labelledby on the dialog");
  assert.match(html, new RegExp(`<h2[^>]*id="${escapeId(labelledBy)}"[^>]*>${title}</h2>`));
}

describe("FormBuilder dialog", () => {
  const html = renderToString(<FormBuilder mode="new" onClose={() => {}} onSaved={() => {}} />);

  it("renders in a native dialog labelled by its title", () => {
    assertLabelledDialog(html, "New form");
  });

  it("has no click-to-close overlay and no second heading", () => {
    assert.doesNotMatch(html, /fixed inset-0/);
    assert.equal(html.match(/>New form</g)?.length, 1);
  });
});

describe("builderDirty", () => {
  const base: BuilderSnapshot = {
    title: "SPOKES Intake",
    description: "",
    isOfficial: false,
    programTypes: ["spokes", "ietp"],
    fields: [{ key: "field_1", label: "Field 1", type: "text", required: false }],
  };

  it("is clean while the template is still loading", () => {
    assert.equal(builderDirty(null, base), false);
  });

  it("is clean when nothing changed", () => {
    assert.equal(builderDirty(base, { ...base }), false);
  });

  it("ignores the order programs were ticked in", () => {
    assert.equal(builderDirty(base, { ...base, programTypes: ["ietp", "spokes"] }), false);
  });

  it("is dirty when the title changes", () => {
    assert.equal(builderDirty(base, { ...base, title: "SPOKES Intake v2" }), true);
  });

  it("is dirty when a field is edited", () => {
    const fields = [{ ...base.fields[0], label: "Phone number" }];
    assert.equal(builderDirty(base, { ...base, fields }), true);
  });
});

describe("ReviewDrawer dialog", () => {
  const html = renderToString(
    <ReviewDrawer
      response={{
        id: "r1",
        templateId: "t1",
        studentId: "s1",
        answers: {},
        status: "submitted",
        submittedAt: null,
        reviewedAt: null,
        reviewerNotes: null,
        student: { id: "s1", studentId: "S-1", displayName: "Sam Lee" },
        template: { id: "t1", title: "SPOKES Intake", schema: [] },
      }}
      onClose={() => {}}
      onReview={async () => {}}
    />,
  );

  it("renders in a native dialog labelled by the form title", () => {
    assertLabelledDialog(html, "SPOKES Intake");
  });

  it("has no click-to-close overlay", () => {
    assert.doesNotMatch(html, /fixed inset-0/);
  });
});
