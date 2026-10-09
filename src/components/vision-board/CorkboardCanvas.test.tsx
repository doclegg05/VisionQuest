import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import CorkboardCanvas from "./CorkboardCanvas";
import type { VisionBoardItemData } from "./VisionBoard";

/**
 * HIG review C-47: the phone remove button is a 44pt target, shows an icon
 * rather than a text glyph, and its name says which pin it removes.
 */

const note: VisionBoardItemData = {
  id: "n1",
  type: "note",
  content: "Finish my GED by June",
  fileId: null,
  goalId: null,
  posX: 0,
  posY: 0,
  width: 20,
  rotation: 0,
  color: "yellow",
  pinColor: "red",
  zIndex: 1,
};

function mobileRemoveButton(html: string): string {
  const button = html.match(/<button[^>]*aria-label="Remove note pin: Finish my GED by June"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(button, "expected a remove button named for the pin");
  return button;
}

describe("CorkboardCanvas phone remove button", () => {
  const html = renderToString(
    <CorkboardCanvas items={[note]} onMove={() => {}} onResize={() => {}} onDelete={() => {}} />,
  );

  it("is a 44pt target", () => {
    const button = mobileRemoveButton(html);
    assert.match(button, /\binline-flex\b/);
    assert.match(button, /\bsize-11\b/);
    assert.match(button, /\bitems-center\b/);
    assert.match(button, /\bjustify-center\b/);
  });

  it("shows an icon, not a text glyph", () => {
    const button = mobileRemoveButton(html);
    assert.match(button, /<svg/);
    assert.doesNotMatch(button, /✕/);
  });
});
