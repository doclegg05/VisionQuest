import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One card treatment app-wide, and a SPOKES left-border callout (spec Design 7). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ruleBody = (selector: string) => {
  const escaped = selector.replace(/[.:()|*+?^${}[\]\\]/g, (c) => `\\${c}`);
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
};

describe("SPOKES cards", () => {
  for (const selector of [".surface-section", ".theme-card", ".panel"]) {
    it(`${selector} is a solid card with a hairline, 12px corners, and the card shadow`, () => {
      const body = ruleBody(selector);
      assert.match(body, /background: var\(--surface-raised\)/);
      assert.match(body, /border: 1px solid var\(--border\)/);
      assert.match(body, /border-radius: var\(--radius-lg\)/);
      assert.match(body, /box-shadow: var\(--shadow-card\)/);
      assert.doesNotMatch(body, /backdrop-filter/);
    });
  }

  it("lifts only cards that are links or buttons", () => {
    const lift = css.match(/\.surface-section:is\(a, button\):hover[^{]*\{([^}]*)\}/);
    assert.ok(lift, "link/button lift rule not found");
    assert.match(lift[1], /transform: translateY\(-5px\)/);
  });

  it("draws callouts with the SPOKES 6px left border", () => {
    assert.match(ruleBody(".callout"), /border-left: 6px solid var\(--success-border\)/);
    assert.match(ruleBody(".callout-gold"), /border-left-color: var\(--gold\)/);
  });
});
