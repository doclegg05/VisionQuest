// src/app/globals.theme-utilities.test.ts
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@tailwindcss/node";

/**
 * Compiles globals.css with the installed Tailwind and checks what each role
 * utility actually paints. Tailwind 4 reads --text-color-*, --border-color-*,
 * --ring-color-* and the other per-property namespaces before --color-*, so
 * one role name gives text, fill, and border their own values. A Tailwind
 * upgrade that changes that lookup fails here, not in production.
 */
const ROLES = ["danger", "success", "warning", "info", "brand-deep"] as const;
const SIZES: ReadonlyArray<readonly [string, string]> = [
  ["xs", "0.8125rem"], ["sm", "0.9375rem"], ["base", "1.0625rem"], ["lg", "1.1rem"], ["xl", "1.375rem"],
  ["2xl", "1.75rem"], ["3xl", "2.125rem"], ["4xl", "2.5rem"], ["5xl", "3.5rem"],
];
const RADII: ReadonlyArray<readonly [string, string]> = [["sm", "6px"], ["md", "8px"], ["lg", "12px"], ["xl", "16px"], ["2xl", "20px"], ["3xl", "24px"]];

const roleClasses = ROLES.flatMap((role) => [`bg-${role}`, `bg-${role}-soft`, `text-${role}`, `text-on-${role}`, `border-${role}`, `ring-${role}`]);
const candidates = [
  ...roleClasses, "bg-danger/10", "bg-surface-muted", "border-line", "text-ink-strong", "text-ink-muted",
  ...SIZES.map(([size]) => `text-${size}`), ...RADII.map(([step]) => `rounded-${step}`),
];

let built = "";
before(async () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const compiler = await compile(css, { base: join(process.cwd(), "src/app"), onDependency: () => {} });
  built = compiler.build(candidates);
});

function rule(className: string): string {
  const selector = `.${className.replace(/[/:[\]().]/g, (c) => `\\${c}`)} {`;
  const start = built.indexOf(selector);
  assert.ok(start >= 0, `${className} generated no rule`);
  return built.slice(start, built.indexOf("}", start));
}

describe("SPOKES role utilities", () => {
  for (const role of ROLES) {
    it(`${role} paints fill, tint, text, ink, border, and ring from its own tokens`, () => {
      assert.match(rule(`bg-${role}`), new RegExp(`background-color: var\\(--${role}-fill\\)`));
      assert.match(rule(`bg-${role}-soft`), new RegExp(`background-color: var\\(--${role}-soft\\)`));
      assert.match(rule(`text-${role}`), new RegExp(`color: var\\(--${role}-text\\)`));
      assert.match(rule(`text-on-${role}`), new RegExp(`color: var\\(--${role}-on\\)`));
      assert.match(rule(`border-${role}`), new RegExp(`border-color: var\\(--${role}-border\\)`));
      assert.match(rule(`ring-${role}`), new RegExp(`--tw-ring-color: var\\(--${role}-border\\)`));
    });
  }

  it("keeps opacity modifiers working", () => {
    assert.match(rule("bg-danger/10"), /color-mix\(in oklab, var\(--danger-fill\) 10%, transparent\)/);
  });

  it("maps neutral helpers onto surface, line, and ink tokens", () => {
    assert.match(rule("bg-surface-muted"), /background-color: var\(--surface-muted\)/);
    assert.match(rule("border-line"), /border-color: var\(--border\)/);
    assert.match(rule("text-ink-strong"), /color: var\(--ink-strong\)/);
    assert.match(rule("text-ink-muted"), /color: var\(--ink-muted\)/);
  });
});

describe("SPOKES type scale and corners", () => {
  for (const [size, value] of SIZES) {
    it(`text-${size} is ${value}`, () => assert.match(rule(`text-${size}`), new RegExp(`font-size: ${value.replace(".", "\\.")}`)));
  }
  for (const [step, value] of RADII) {
    it(`rounded-${step} is ${value}`, () => assert.match(rule(`rounded-${step}`), new RegExp(`border-radius: ${value}`)));
  }
});
