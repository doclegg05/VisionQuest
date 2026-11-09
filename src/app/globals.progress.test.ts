import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SPOKES --grad-progress runs primary to gold. Gold on a light track is about
 * 1.8:1, under the 3:1 floor for graphics, so the fill carries an inset edge in
 * --progress-edge (navy in light, gold in dark). globals.contrast.test.ts checks
 * that edge against the page, cards, and muted panels.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("SPOKES progress fill", () => {
  it("uses the SPOKES gradient with a contrast edge", () => {
    const match = css.match(/\.progress-fill\s*\{([^}]*)\}/);
    assert.ok(match, ".progress-fill rule not found");
    assert.match(match[1], /background: var\(--grad-progress\)/);
    assert.match(match[1], /box-shadow: inset 0 0 0 1px var\(--progress-edge\)/);
  });
});
