import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

import OrientationWelcomeVideo from "./OrientationWelcomeVideo";

describe("OrientationWelcomeVideo transcript", () => {
  it("does not claim the video says 'tap my symbol' — that scene was cut (commit 0276a2b)", () => {
    // The mp4 and the VTT both dropped this cue on 2026-07-31 when the
    // "symbol scene" was removed from the video (git show 0276a2b removed
    // the 00:44.550-->00:49.720 cue and re-encoded the mp4, 36.9MB->34.6MB).
    // The on-page transcript kept the sentence through the later
    // readability rewrite (33526e3), so it described audio that no longer
    // exists. Regression guard for that exact drift class.
    const html = renderToString(<OrientationWelcomeVideo />);
    assert.ok(
      !html.includes("tap my symbol"),
      "the on-page transcript still claims audio the video no longer contains",
    );
  });

  it("the shipped VTT has no cue for the removed 'tap my symbol' line either", () => {
    // Cross-checks the fix against the actual caption file, not just the
    // component: both must agree the video no longer says this.
    const vtt = readFileSync(
      join(process.cwd(), "public", "media", "sage-welcome-orientation.vtt"),
      "utf8",
    );
    assert.ok(!vtt.includes("tap my symbol"));
  });
});
