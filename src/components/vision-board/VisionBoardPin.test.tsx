import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import VisionBoardPin, { removePinLabel, resizeWidthForKey } from "./VisionBoardPin";
import type { VisionBoardItemData } from "./VisionBoard";

const GOAL_ITEM: VisionBoardItemData = {
  id: "g1",
  type: "goal",
  content: "Get a CDL",
  fileId: null,
  goalId: "goal-1",
  posX: 0,
  posY: 0,
  width: 20,
  rotation: 0,
  color: null,
  pinColor: "blue",
  zIndex: 1,
};

/**
 * HIG review C-47: a remove control names the pin it removes, and the
 * corkboard's drag handles are 44pt targets on touch.
 */

describe("removePinLabel", () => {
  it("names the pin by its kind and text", () => {
    assert.equal(removePinLabel({ type: "note", content: "Finish my GED" }), "Remove note pin: Finish my GED");
    assert.equal(removePinLabel({ type: "goal", content: "Get a CDL" }), "Remove goal pin: Get a CDL");
  });

  it("falls back to the kind when the pin has no text", () => {
    assert.equal(removePinLabel({ type: "image", content: null }), "Remove image pin");
    assert.equal(removePinLabel({ type: "note", content: "   " }), "Remove note pin");
  });

  it("shortens long text and collapses line breaks", () => {
    const label = removePinLabel({ type: "note", content: `First line\n${"word ".repeat(30)}` });
    assert.ok(label.startsWith("Remove note pin: First line word"), label);
    assert.ok(label.endsWith("…"), label);
    assert.ok(label.length <= "Remove note pin: ".length + 41, label);
  });
});

describe("VisionBoardPin remove button", () => {
  // Desktop hides the phone list, so this button is the only way to remove a
  // pin there. It must exist without a mouse hover, for keyboard and VoiceOver.
  it("is in the page before any hover and shows on keyboard focus", () => {
    const html = renderToString(<VisionBoardPin item={GOAL_ITEM} onDelete={() => {}} />);
    const button = html.match(/<button[^>]*aria-label="Remove goal pin: Get a CDL"[^>]*>/)?.[0];
    assert.ok(button, "expected the remove button without hover");
    assert.match(button, /\bfocus-visible:opacity-100\b/);
    assert.match(button, /\bpointer-coarse:opacity-100\b/);
  });
});

describe("VisionBoardPin resize handle", () => {
  it("is a 44pt target", () => {
    const html = renderToString(<VisionBoardPin item={GOAL_ITEM} onDelete={() => {}} />);
    const handle = html.match(/<button[^>]*aria-label="Resize pin"[^>]*>/)?.[0];
    assert.ok(handle, "expected a resize handle");
    assert.match(handle, /\bsize-11\b/);
  });
});

describe("resizeWidthForKey", () => {
  const bounds = { min: 16, max: 34 };

  it("widens on ArrowRight and narrows on ArrowLeft", () => {
    assert.equal(resizeWidthForKey("ArrowRight", 20, bounds), 22);
    assert.equal(resizeWidthForKey("ArrowLeft", 20, bounds), 18);
  });

  it("stays inside the pin's size limits", () => {
    assert.equal(resizeWidthForKey("ArrowRight", 33, bounds), 34);
    assert.equal(resizeWidthForKey("ArrowLeft", 17, bounds), 16);
  });

  it("ignores other keys", () => {
    assert.equal(resizeWidthForKey("Enter", 20, bounds), null);
    assert.equal(resizeWidthForKey("ArrowUp", 20, bounds), null);
  });
});
