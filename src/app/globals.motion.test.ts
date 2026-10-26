import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPOKES motion stays off for people who ask for reduced motion (spec Design 4). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("reduced motion", () => {
  it("still zeroes every transition and animation", () => {
    assert.match(reduced, /transition-duration: 0\.01ms !important/);
    assert.match(reduced, /animation-duration: 0\.01ms !important/);
  });

  it("cancels the hover lifts, not just their animation", () => {
    for (const selector of [".primary-button:hover", ".surface-section:hover"]) {
      const at = reduced.indexOf(selector);
      assert.ok(at >= 0, `${selector} missing from the reduced-motion block`);
      assert.match(reduced.slice(at, reduced.indexOf("}", at)), /transform: none/);
    }
  });
});
