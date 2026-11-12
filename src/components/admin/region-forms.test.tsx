import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { AddRegionForm } from "./AddRegionForm";
import { RegionNameField } from "./RegionNameField";
import { RenameForm } from "./RegionRows";
import { RegionsCardView, type RegionsHandlers } from "./RegionsCardView";
import type { AdminRegion } from "./regions-model";

const north: AdminRegion = { id: "r1", name: "North", code: "north", status: "active", classCount: 0, coordinators: [] };

function clean(html: string): string {
  return html.replaceAll("<!-- -->", "").replaceAll("&quot;", '"');
}

function addForm(overrides: Partial<Parameters<typeof AddRegionForm>[0]> = {}): string {
  return clean(
    renderToString(
      <AddRegionForm busy={false} adding={false} error={null} codeTaken={false} regions={[north]} onCreate={async () => true} {...overrides} />,
    ),
  );
}

describe("the add form's short code", () => {
  it("is hidden at first, and says it is made from the name", () => {
    const html = addForm();
    assert.equal(html.includes('id="new-region-code"'), false);
    assert.ok(html.includes("Short code: made from the name"));
  });

  it("offers a Change it button at least 44px tall", () => {
    assert.match(addForm(), /<button type="button"[^>]*min-h-11[^>]*>Change it<\/button>/);
  });

  it("opens the field, with its help, when the code is taken", () => {
    const html = addForm({ codeTaken: true, error: 'Another region already uses the short code "north". Change the short code and try again.' });
    assert.ok(html.includes('id="new-region-code"'));
    assert.ok(html.includes("A short ID for this region, used in reports. Letters, numbers and dashes only."));
    assert.ok(html.includes('Another region already uses the short code "north".'));
  });
});

describe("a name another region already has", () => {
  it("is not warned about while the name is new", () => {
    assert.equal(addForm().includes("There is already a region called"), false);
  });

  it("is warned about under the name field, tied to it", () => {
    const html = clean(
      renderToString(
        <RegionNameField
          id="rename-r1"
          label="New name"
          value="east"
          onChange={() => {}}
          regions={[north, { ...north, id: "r2", name: "East" }]}
          exceptId="r1"
          error={null}
        />,
      ),
    );
    assert.ok(html.includes("There is already a region called East."));
    assert.match(html, /<input[^>]*aria-describedby="rename-r1-warning"/);
  });

  it("is not warned about for the region's own name", () => {
    const html = renderToString(
      <RegionNameField id="rename-r1" label="New name" value="North" onChange={() => {}} regions={[north]} exceptId="r1" error={null} />,
    );
    assert.equal(html.includes("There is already"), false);
  });
});

describe("a rename that fails", () => {
  const html = clean(
    renderToString(
      <RenameForm
        region={north}
        regions={[north]}
        busy={false}
        saving={false}
        error="This region was changed somewhere else. Reload the page."
        onSave={() => {}}
        onCancel={() => {}}
      />,
    ),
  );

  it("shows the error inside the form, under its input", () => {
    const input = html.indexOf("<input");
    const error = html.indexOf("This region was changed somewhere else.");
    assert.ok(input >= 0 && error > input, "the error follows the input");
    assert.ok(error < html.indexOf("</form>"), "inside the form");
  });

  it("ties the error to the input", () => {
    assert.match(html, /<input[^>]*aria-describedby="rename-r1-error"/);
    assert.match(html, /id="rename-r1-error"/);
  });
});

describe("the card while it loads", () => {
  const handlers: RegionsHandlers = {
    onRetry: () => {},
    onToggle: () => {},
    onCreate: async () => true,
    onRename: async () => true,
    onAssign: async () => true,
    onRemove: async () => true,
  };

  it("announces the loading line to screen readers", () => {
    const html = clean(renderToString(<RegionsCardView state={{ kind: "loading" }} handlers={handlers} />));
    assert.match(html, /<p role="status"[^>]*>Loading regions/);
  });
});
