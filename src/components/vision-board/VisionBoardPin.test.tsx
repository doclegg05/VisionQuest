import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import VisionBoardPin, { removePinLabel } from "./VisionBoardPin";
import type { VisionBoardItemData } from "./VisionBoard";

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

describe("VisionBoardPin resize handle", () => {
  it("is a 44pt target", () => {
    const item: VisionBoardItemData = {
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
    const html = renderToString(<VisionBoardPin item={item} onDelete={() => {}} />);
    const handle = html.match(/<button[^>]*aria-label="Resize pin"[^>]*>/)?.[0];
    assert.ok(handle, "expected a resize handle");
    assert.match(handle, /\bsize-11\b/);
  });
});
