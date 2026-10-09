import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { UndoToastView } from "./useUndo";

/**
 * The undo notice is how a removal is taken back (HIG review B-32, C-47). It
 * must be announced, reachable by touch, stay until the person acts on it,
 * and keep a visible focus ring on its inverted background.
 */

const noop = () => {};

function render(snapshot: Parameters<typeof UndoToastView>[0]["snapshot"]): string {
  return renderToString(<UndoToastView snapshot={snapshot} onUndo={noop} onDismiss={noop} />);
}

describe("UndoToastView", () => {
  it("keeps an empty polite live region mounted when nothing is pending", () => {
    const html = render(null);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.doesNotMatch(html, /<button/);
  });

  it("offers Undo and Dismiss, both 44pt, while a removal is pending", () => {
    const html = render({ id: 3, kind: "pending", label: "Goal removed." });
    assert.match(html, /Goal removed\./);
    const undo = html.match(/<button[^>]*>Undo<\/button>/)?.[0];
    const dismiss = html.match(/<button[^>]*aria-label="Dismiss"[^>]*>/)?.[0];
    assert.ok(undo, "expected an Undo button");
    assert.ok(dismiss, "expected a Dismiss button");
    assert.match(undo, /min-h-11/);
    assert.match(dismiss, /size-11/);
  });

  it("announces a restore with no buttons", () => {
    const html = render({ id: 4, kind: "restored", label: "Goal restored." });
    assert.match(html, /Goal restored\./);
    assert.doesNotMatch(html, /<button/);
  });

  it("re-renders the notice for each new id, so a repeated label is announced", () => {
    assert.match(render({ id: 7, kind: "pending", label: "Pin removed." }), /data-notice-id="7"/);
  });

  it("keeps the focus ring visible on its inverted background", () => {
    assert.match(render({ id: 1, kind: "pending", label: "Pin removed." }), /\[--accent-strong:var\(--surface-base\)\]/);
  });

  it("sits above the phone tab bar and takes its colors from theme tokens", () => {
    const html = render({ id: 1, kind: "pending", label: "Pin removed." });
    assert.match(html, /env\(safe-area-inset-bottom/);
    assert.match(html, /bg-\[var\(--ink-strong\)\]/);
    assert.doesNotMatch(html, /text-white|bg-black|bg-gray/);
  });
});
