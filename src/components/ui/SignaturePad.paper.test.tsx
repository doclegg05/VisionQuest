import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import SignaturePad from "./SignaturePad";

/**
 * Signature ink is a fixed dark navy (it must be: the exported PNG is drawn on
 * white). On the theme's dark raised surface that ink measured about 1.1:1, so
 * a student signing in dark mode could not see their own strokes. The pad is
 * paper in both themes: a white ground, with the light theme's tokens scoped
 * to it so the caption and placeholder stay legible on that white.
 *
 * `renderToString` only reaches draw mode (type mode is behind a state toggle);
 * the type pad uses the same two attributes.
 */

describe("SignaturePad paper ground", () => {
  it("draw mode: the surface under the canvas is white and scoped to the light theme", () => {
    const html = renderToString(<SignaturePad onSign={() => {}} onCancel={() => {}} />);
    const padOpen = /<div\b([^>]*)><canvas\b/.exec(html);
    assert.ok(padOpen, "the canvas sits directly inside its pad surface");
    const attrs = padOpen[1];

    assert.match(attrs, /data-theme="light"/, "tokens inside the pad must resolve to their light values");
    assert.match(attrs, /\bbg-white\b/, "the pad ground matches the white PNG export");
    assert.doesNotMatch(attrs, /surface-raised/, "a theme surface turns dark under fixed dark ink");
  });
});
