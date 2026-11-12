import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { RegionsCardView, type RegionsHandlers } from "./RegionsCardView";
import { REGIONS_COPY } from "./regions-copy";
import type { AdminRegion, RegionPerson } from "./regions-model";
import type { ReadyState, RegionsState } from "./regions-reducer";

const handlers: RegionsHandlers = {
  onRetry: () => {},
  onToggle: () => {},
  onCreate: async () => true,
  onRename: async () => true,
  onAssign: async () => true,
  onRemove: async () => true,
};

const pat: RegionPerson = { id: "u1", displayName: "Pat Lee", email: "pat@example.org" };
const sam: RegionPerson = { id: "u2", displayName: "Sam Roy", email: null };

const north: AdminRegion = { id: "r1", name: "North", code: "north", status: "active", classCount: 2, coordinators: [pat] };
const east: AdminRegion = { id: "r2", name: "East", code: "east", status: "active", classCount: 0, coordinators: [] };

function ready(overrides: Partial<ReadyState> = {}): ReadyState {
  return { kind: "ready", regions: [east, north], people: [pat, sam], open: true, busy: null, failure: null, notice: "", ...overrides };
}

/** React escapes apostrophes and splits text with comment markers; undo both to read the copy. */
function render(state: RegionsState): string {
  return renderToString(<RegionsCardView state={state} handlers={handlers} />)
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
}

function alerts(html: string): string[] {
  return [...html.matchAll(/<p role="alert"[^>]*>(.*?)<\/p>/g)].map((match) => match[1]);
}

describe("RegionsCardView while loading", () => {
  it("says the regions are loading", () => {
    const html = render({ kind: "loading" });
    assert.ok(html.includes(REGIONS_COPY.loading));
    assert.ok(html.includes(">Regions</h2>"));
  });
});

describe("RegionsCardView when the load fails", () => {
  const html = render({ kind: "load-failed", message: "Admin access required." });

  it("shows the server's message as an alert", () => {
    assert.deepEqual(alerts(html), ["Admin access required."]);
  });

  it("offers a way to try again", () => {
    assert.ok(html.includes(">Try again</button>"));
  });
});

describe("RegionsCardView on a system with no regions", () => {
  const html = render(ready({ regions: [], people: [] }));

  it("says what to do first", () => {
    assert.ok(html.includes(REGIONS_COPY.empty));
  });

  it("shows the form that adds the first region", () => {
    assert.ok(html.includes(">Region name</label>"));
    assert.ok(html.includes("Short code: made from the name"));
    assert.ok(html.includes(">Change it</button>"));
    assert.ok(html.includes(">Add region</button>"));
  });

  it("lists no regions", () => {
    assert.equal(html.includes("<li"), false);
  });
});

describe("RegionsCardView with regions, closed", () => {
  const html = render(ready({ open: false }));

  it("sums the regions up in one line", () => {
    assert.ok(html.includes("2 regions"));
    assert.equal(html.includes("archived"), false);
  });

  it("offers a labelled control to open the list", () => {
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes(">Manage regions</button>"));
  });

  it("keeps the list and the form out of the way", () => {
    assert.equal(html.includes("North"), false);
    assert.equal(html.includes("Add region"), false);
  });
});

describe("RegionsCardView with regions, open", () => {
  const html = render(ready());

  it("lists each region with its class count", () => {
    assert.ok(html.includes("North"));
    assert.ok(html.includes("2 classes"));
    assert.ok(html.includes("East"));
    assert.ok(html.includes("No classes yet"));
  });

  it("offers no way to archive or restore a region", () => {
    assert.doesNotMatch(html, /archiv|restor/i);
  });

  it("lists a region's coordinators with a remove control that names them", () => {
    assert.ok(html.includes("Pat Lee"));
    assert.ok(html.includes('aria-label="Remove Pat Lee from North"'));
  });

  it("offers only people who are not in the region already", () => {
    const northPicker = html.slice(html.indexOf('id="add-coordinator-r1"'), html.indexOf("</select>", html.indexOf('id="add-coordinator-r1"')));
    assert.ok(northPicker.includes("Sam Roy"));
    assert.equal(northPicker.includes("Pat Lee"), false);
  });

  it("never shows the short-lived empty state once a region exists", () => {
    assert.equal(html.includes(REGIONS_COPY.empty), false);
  });

  it("can be linked to as #regions", () => {
    assert.match(html, /<section id="regions"/);
  });

  it("says how to add a new coordinator when no one is on offer: through an invite", () => {
    const none = render(ready({ regions: [east], people: [] }));
    assert.equal(none.includes('id="add-coordinator-r2"'), false);
    assert.ok(
      textOf(none).includes(
        "No one to pick yet. Go to Invite Staff at the bottom of this page. Choose Regional coordinator as the role and East as the region. They join this region when they accept.",
      ),
    );
    assert.match(none, /<a href="#invite-staff"[^>]*>Invite Staff<\/a>/);
  });

  it("points to the invite under the picker when the person is not in it", () => {
    const north = html.slice(html.indexOf('id="region-r1"'));
    assert.ok(textOf(north).includes("Not in the list? Invite them with the role Regional coordinator."));
    assert.match(north, /<a href="#invite-staff"[^>]*>Invite them<\/a>/);
  });

  it("announces the last saved change", () => {
    const saved = render(ready({ notice: "East was added." }));
    assert.ok(saved.includes('<p role="status"'));
    assert.ok(saved.includes("East was added."));
  });
});

describe("RegionsCardView when a save fails", () => {
  it("shows the server's message as an alert in the add form", () => {
    const html = render(ready({ failure: { target: { kind: "create" }, message: "That region code is already in use." } }));
    assert.deepEqual(alerts(html), ["That region code is already in use."]);
  });

  it("shows the server's message as an alert on the region that failed, and only there", () => {
    const html = render(ready({ failure: { target: { kind: "region", regionId: "r1" }, message: "Region not found." } }));
    assert.deepEqual(alerts(html), ["Region not found."]);
    // Rows render in list order: East (r2), then North (r1).
    const eastRow = html.slice(html.indexOf('id="region-r2"'), html.indexOf('id="region-r1"'));
    const northRow = html.slice(html.indexOf('id="region-r1"'));
    assert.equal(eastRow.includes("Region not found."), false);
    assert.ok(northRow.includes("Region not found."));
  });
});

describe("RegionsCardView while a request is in flight", () => {
  const html = render(ready({ busy: { kind: "region", regionId: "r1" } }));

  it("disables every button that would start another request", () => {
    const live = tags(html, "button").filter((tag) => !tag.includes("disabled") && !tag.includes("aria-expanded"));
    assert.deepEqual(live, []);
  });
});

describe("RegionsCardView accessibility floor", () => {
  const views = [render(ready()), render(ready({ regions: [], people: [] })), render({ kind: "load-failed", message: "x" })];

  it("gives every input and select a label", () => {
    for (const html of views) {
      for (const field of [...tags(html, "input"), ...tags(html, "select")]) {
        const id = field.match(/\bid="([^"]+)"/)?.[1];
        assert.ok(id, `field has an id: ${field}`);
        assert.ok(html.includes(`for="${id}"`), `label for ${id}`);
      }
    }
  });

  it("makes the row focusable, so focus can land on it after a removal", () => {
    assert.match(views[0], /<li id="region-r1" tabindex="-1"/);
  });

  it("makes every button and field at least 44px tall", () => {
    for (const html of views) {
      for (const control of [...tags(html, "button"), ...tags(html, "input"), ...tags(html, "select")]) {
        assert.ok(/\bmin-h-11\b/.test(control), `44px target: ${control}`);
      }
    }
  });

  it("uses no id twice", () => {
    for (const html of views) {
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      assert.equal(new Set(ids).size, ids.length);
    }
  });
});
