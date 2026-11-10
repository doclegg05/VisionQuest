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
  onArchive: () => {},
  onRestore: () => {},
  onAssign: async () => true,
  onRemove: () => {},
};

const pat: RegionPerson = { id: "u1", displayName: "Pat Lee", email: "pat@example.org" };
const sam: RegionPerson = { id: "u2", displayName: "Sam Roy", email: null };

const north: AdminRegion = { id: "r1", name: "North", code: "north", status: "active", classCount: 2, coordinators: [pat] };
const east: AdminRegion = { id: "r2", name: "East", code: "east", status: "active", classCount: 0, coordinators: [] };
const old: AdminRegion = { id: "r3", name: "Old Valley", code: "old", status: "archived", classCount: 1, coordinators: [] };

function ready(overrides: Partial<ReadyState> = {}): ReadyState {
  return { kind: "ready", regions: [east, north, old], people: [pat, sam], open: true, busy: null, failure: null, notice: "", ...overrides };
}

/** React escapes apostrophes and splits text with comment markers; undo both to read the copy. */
function render(state: RegionsState): string {
  return renderToString(<RegionsCardView state={state} handlers={handlers} />)
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");
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
    assert.ok(html.includes(">Short code</label>"));
    assert.ok(html.includes(">Add region</button>"));
  });

  it("lists no regions", () => {
    assert.equal(html.includes("<li"), false);
  });
});

describe("RegionsCardView with regions, closed", () => {
  const html = render(ready({ open: false }));

  it("sums the regions up in one line", () => {
    assert.ok(html.includes("2 regions, 1 archived"));
  });

  it("offers a labelled control to open the list", () => {
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes(">Manage regions</button>"));
  });

  it("keeps the list and the form out of the way", () => {
    assert.equal(html.includes("Old Valley"), false);
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

  it("says in words that an archived region is archived, and offers to restore it", () => {
    assert.ok(html.includes("Archived regions"));
    assert.ok(html.includes("Old Valley"));
    assert.ok(html.includes(">Restore</button>"));
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

  it("says how to add a new coordinator when no one is on offer", () => {
    const none = render(ready({ regions: [east], people: [] }));
    assert.ok(none.includes(REGIONS_COPY.noCoordinatorChoices));
    assert.equal(none.includes('id="add-coordinator-r2"'), false);
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
    // Rows render in list order: East (r2), North (r1), then the archived one (r3).
    const eastRow = html.slice(html.indexOf('id="region-r2"'), html.indexOf('id="region-r1"'));
    const northRow = html.slice(html.indexOf('id="region-r1"'), html.indexOf('id="region-r3"'));
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
