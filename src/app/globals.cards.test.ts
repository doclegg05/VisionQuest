import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One card treatment app-wide, and a SPOKES left-border callout (spec Design 7). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Body of the rule with this exact selector; `layered` reads the indented rule inside @layer instead. */
const ruleBody = (selector: string, layered = false) => {
  const escaped = selector.replace(/[.:()|*+?^${}[\]\\]/g, (c) => `\\${c}`);
  const match = css.match(new RegExp(`(?:^|\\n)${layered ? "\\s+" : ""}${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
};

/** Bodies of every `@layer <name> { ... }` block, by brace matching. */
function layerBlocks(name: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(`@layer ${name} {`, from);
    if (at < 0) return blocks;
    let depth = 0;
    let i = css.indexOf("{", at);
    const start = i + 1;
    for (; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}" && --depth === 0) break;
    }
    blocks.push(css.slice(start, i));
    from = i;
  }
}

describe("SPOKES cards", () => {
  for (const selector of [".surface-section", ".theme-card", ".panel"]) {
    it(`${selector} is a solid card with a hairline, 12px corners, and the card shadow`, () => {
      const body = ruleBody(selector);
      assert.match(body, /background: var\(--surface-raised\)/);
      assert.match(body, /border: 1px solid var\(--border\)/);
      assert.match(body, /box-shadow: var\(--shadow-card\)/);
      assert.doesNotMatch(body, /backdrop-filter/);
    });
  }

  it("sets the card radius inside @layer components so a rounded-* utility on the element wins", () => {
    const layered = layerBlocks("components").join("\n");
    const rule = layered.match(/(?:^|\n)\s*([^{}]*)\{([^}]*border-radius: var\(--radius-lg\)[^}]*)\}/g) ?? [];
    const selectors = rule.join(" ");
    for (const selector of [".surface-section", ".theme-card", ".panel"]) {
      assert.ok(selectors.includes(selector), `${selector} radius is not in @layer components`);
      assert.doesNotMatch(ruleBody(selector), /border-radius/, `${selector} sets an unlayered radius that beats rounded-*`);
    }
  });

  it("lifts only cards that are links or buttons", () => {
    const lift = css.match(/\.surface-section:is\(a, button\):hover[^{]*\{([^}]*)\}/);
    assert.ok(lift, "link/button lift rule not found");
    assert.match(lift[1], /transform: translateY\(-5px\)/);
  });

  it("draws callouts with the SPOKES 6px left border", () => {
    assert.match(ruleBody(".callout", true), /border-left: 6px solid var\(--success-border\)/);
    assert.match(ruleBody(".callout-gold", true), /border-left-color: var\(--gold\)/);
  });
});
