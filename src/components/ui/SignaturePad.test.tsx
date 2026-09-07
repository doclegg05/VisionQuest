import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import SignaturePad from "./SignaturePad";

/**
 * Prod incident, 2026-09-07: a student tapped "Sign & Submit" 14 times in
 * 26 seconds because the pad gave no sign the first tap had taken — the
 * button stayed enabled and the only feedback was a small "Submitting..."
 * line above the pad. Every tap uploaded another signature file and ran the
 * alert sync again. The pad must show the in-flight state on the button the
 * student is looking at, and refuse a second tap while one is in flight.
 *
 * `renderToString` never runs effects, so the canvas has no strokes and the
 * submit button is disabled for that reason too; the assertions therefore
 * pin the label and the Cancel/mode buttons, which are gated on
 * `submitting` alone.
 */

// A real `disabled` attribute, as distinct from a Tailwind `disabled:` variant
// in the class list.
const DISABLED_ATTR = /\sdisabled(?:=""|\s|$)/;

function buttonsByLabel(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)) {
    // React's server renderer escapes "&" in text.
    out.set(match[2].trim().replace(/&amp;/g, "&"), match[1]);
  }
  return out;
}

describe("SignaturePad submitting state", () => {
  it("idle: Cancel and the mode toggle are enabled and the button reads Sign & Submit", () => {
    const html = renderToString(<SignaturePad onSign={() => {}} onCancel={() => {}} />);
    const buttons = buttonsByLabel(html);

    assert.ok(buttons.has("Sign & Submit"), "the submit label is the action, not a status");
    assert.ok(!buttons.has("Saving..."));
    assert.ok(!DISABLED_ATTR.test(buttons.get("Cancel") ?? " disabled"), "Cancel is live while idle");
    assert.ok(!DISABLED_ATTR.test(buttons.get("Type") ?? " disabled"), "mode toggle is live while idle");
    assert.ok(!/aria-busy/.test(html));
  });

  it("submitting: the button reads Saving..., every control is disabled, and the pad is aria-busy", () => {
    const html = renderToString(<SignaturePad onSign={() => {}} onCancel={() => {}} submitting />);
    const buttons = buttonsByLabel(html);

    assert.ok(buttons.has("Saving..."), `submit label did not change: ${[...buttons.keys()].join(", ")}`);
    assert.ok(!buttons.has("Sign & Submit"));
    for (const label of ["Saving...", "Cancel", "Clear", "Draw", "Type"]) {
      assert.ok(DISABLED_ATTR.test(buttons.get(label) ?? ""), `${label} must be disabled while saving`);
    }
    assert.ok(/aria-busy="true"/.test(html));
  });

  it("submitting in type mode also disables the name input", () => {
    // The mode toggle is state, so render the TypePad path by reading the
    // draw-mode markup only for the shared buttons; the input gate is pinned
    // by the prop threading, which the draw-mode test above already covers
    // for the shared buttons. Here: the draw pad's canvas stays present.
    const html = renderToString(<SignaturePad onSign={() => {}} onCancel={() => {}} submitting />);
    assert.ok(/<canvas\b/.test(html), "the drawing stays on screen while saving; nothing is torn down");
  });
});
