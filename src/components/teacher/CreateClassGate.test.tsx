import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { renderToString } from "react-dom/server";

let mod: typeof import("./CreateClassGate");
before(async () => {
  mod = await import("./CreateClassGate");
});

describe("createClassVisibility", () => {
  it("shows the form on the admin page, even with no region yet", () => {
    assert.equal(mod.createClassVisibility({ manageRegions: true, regionCount: 0, loading: false }), "form");
    assert.equal(mod.createClassVisibility({ manageRegions: true, regionCount: 0, loading: true }), "form");
  });

  it("shows the form to an instructor who has a region", () => {
    assert.equal(mod.createClassVisibility({ manageRegions: false, regionCount: 1, loading: false }), "form");
  });

  it("keeps the form while a placed instructor's list reloads", () => {
    assert.equal(mod.createClassVisibility({ manageRegions: false, regionCount: 2, loading: true }), "form");
  });

  it("shows the hint, not the form, to an instructor with no region", () => {
    assert.equal(mod.createClassVisibility({ manageRegions: false, regionCount: 0, loading: false }), "hint");
  });

  it("shows nothing until the first answer, so the form never flashes", () => {
    assert.equal(mod.createClassVisibility({ manageRegions: false, regionCount: 0, loading: true }), "pending");
  });
});

describe("CreateClassHint", () => {
  const render = (input: { manageRegions: boolean; regionCount: number; loading: boolean }) =>
    renderToString(<mod.CreateClassHint {...input} />).replaceAll("<!-- -->", "");

  it("tells an instructor with no region who to ask", () => {
    const html = render({ manageRegions: false, regionCount: 0, loading: false });
    assert.ok(html.includes("You are not in a region yet. Ask your program admin to add you to a region."));
    assert.ok(!html.includes("<button"));
    assert.ok(!html.includes("<input"));
  });

  it("renders nothing when the form shows", () => {
    assert.equal(render({ manageRegions: false, regionCount: 1, loading: false }), "");
    assert.equal(render({ manageRegions: true, regionCount: 0, loading: false }), "");
  });

  it("renders nothing while loading", () => {
    assert.equal(render({ manageRegions: false, regionCount: 0, loading: true }), "");
  });

  it("uses no dash characters", () => {
    assert.doesNotMatch(render({ manageRegions: false, regionCount: 0, loading: false }), /[–—]/);
  });
});
