import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPOKES title treatment: navy-to-primary ground, white text, a short gold rule (spec Design 7). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ruleBody = (selector: string) => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.:]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
};

describe("SPOKES page header", () => {
  it("paints the SPOKES title gradient from palette tokens only", () => {
    assert.match(ruleBody(".page-hero"), /background: linear-gradient\(135deg, var\(--primary\) 0%, var\(--dark\) 100%\)/);
  });

  it("keeps eyebrow, title, and subtitle fully white, which clears 4.5:1 on primary", () => {
    for (const selector of [".page-hero .page-eyebrow", ".page-subtitle"]) assert.match(ruleBody(selector), /color: var\(--light\)/);
  });

  it("does not paint eyebrows white outside .page-hero, where the ground is light", () => {
    assert.doesNotMatch(ruleBody(".page-eyebrow"), /color:/);
  });

  it("underlines the title with a 48px by 3px gold rule", () => {
    const rule = ruleBody(".page-title::after");
    assert.match(rule, /width: 48px/);
    assert.match(rule, /height: 3px/);
    assert.match(rule, /background: var\(--gold\)/);
  });

  it("drops the diagonal stripes and the angled gold line", () => {
    assert.doesNotMatch(css, /\.page-hero::before/);
    assert.doesNotMatch(css, /\.page-hero::after/);
  });
});
