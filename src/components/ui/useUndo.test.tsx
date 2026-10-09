import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { UndoToastView } from "./useUndo";

/**
 * The undo toast is how a removal is taken back (HIG review B-32, C-47). It
 * must be announced, reachable by touch, and stay clear of the phone tab bar.
 */

describe("UndoToastView", () => {
  it("keeps an empty polite live region mounted when nothing is pending", () => {
    const html = renderToString(<UndoToastView label={null} onUndo={() => {}} />);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.doesNotMatch(html, /<button/);
  });

  it("shows the label and a 44pt Undo button when a removal is pending", () => {
    const html = renderToString(<UndoToastView label="Goal removed." onUndo={() => {}} />);
    assert.match(html, /Goal removed\./);
    const button = html.match(/<button[^>]*>Undo<\/button>/)?.[0];
    assert.ok(button, "expected an Undo button");
    assert.match(button, /min-h-11/);
  });

  it("sits above the phone tab bar and the safe area", () => {
    const html = renderToString(<UndoToastView label="Pin removed." onUndo={() => {}} />);
    assert.match(html, /env\(safe-area-inset-bottom/);
  });

  it("takes its colors from theme tokens", () => {
    const html = renderToString(<UndoToastView label="Pin removed." onUndo={() => {}} />);
    assert.match(html, /bg-\[var\(--ink-strong\)\]/);
    assert.match(html, /text-\[var\(--surface-base\)\]/);
    assert.doesNotMatch(html, /text-white|bg-black|bg-gray/);
  });
});
