// src/lib/spokes-class-map.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapClass, rewriteClassList } from "../../scripts/lib/spokes-class-map.mjs";

const to = (token: string) => {
  const result = mapClass(token);
  return result && "to" in result ? result.to : result;
};

describe("hue classes become SPOKES roles", () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["bg-red-50", "bg-danger-soft"],
    ["bg-red-600", "bg-danger"],
    ["text-emerald-700", "text-success"],
    ["border-amber-300", "border-warning"],
    ["border-l-red-500", "border-l-danger"],
    ["hover:bg-blue-700", "hover:bg-info"],
    ["bg-red-500/10", "bg-danger/10"],
    ["from-sky-100", "from-info-soft"],
    ["bg-indigo-50", "bg-brand-deep-soft"],
    ["ring-teal-400", "ring-info"],
    ["fill-orange-500", "fill-warning"],
    ["dark:bg-red-950/40", null],
    ["text-gray-500", "text-ink-muted"],
    ["text-slate-900", "text-ink-strong"],
    ["bg-gray-100", "bg-surface-muted"],
    ["border-gray-200", "border-line"],
  ];
  for (const [input, expected] of cases) it(`${input} -> ${expected}`, () => assert.equal(to(input), expected));

  it("sends text with opacity, placeholder hues, and odd neutrals to review", () => {
    for (const token of ["text-red-600/80", "placeholder-gray-400", "bg-gray-700"]) {
      const result = mapClass(token);
      assert.ok(result && "review" in result, token);
    }
  });
});

describe("token text, display family, corners, and small text", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["text-[var(--error)]", "text-danger"],
    ["text-[var(--accent-green)]", "text-success"],
    ["hover:text-[var(--primary)]", "hover:text-info"],
    ["text-accent-gold", "text-warning"],
    ["font-[family-name:var(--font-display)]", "font-display"],
    ["rounded-[1rem]", "rounded-xl"],
    ["rounded-[1.2rem]", "rounded-2xl"],
    ["rounded-t-[1.4rem]", "rounded-t-3xl"],
    ["rounded-[0.85rem]", "rounded-lg"],
    ["rounded-[2rem]", "rounded-3xl"],
    ["text-[0.65rem]", "text-xs"],
    ["text-[11px]", "text-xs"],
  ];
  for (const [input, expected] of cases) it(`${input} -> ${expected}`, () => assert.equal(to(input), expected));

  it("leaves text sizes at or above 13px and unrelated classes alone", () => {
    for (const token of ["text-[15px]", "text-[13px]", "px-4", "bg-[var(--surface-raised)]", "text-danger"]) {
      assert.equal(mapClass(token), null, token);
    }
  });
});

describe("rewriteClassList", () => {
  it("drops a heavy weight only when the list uses the display font", () => {
    assert.equal(rewriteClassList("font-display text-2xl font-bold").output, "font-display text-2xl");
    assert.equal(rewriteClassList("font-bold text-lg").output, "font-bold text-lg");
  });

  it("keeps leading and trailing whitespace for template pieces", () => {
    assert.equal(rewriteClassList(" bg-red-50 ").output, " bg-danger-soft ");
  });

  it("returns the input unchanged when nothing maps", () => {
    const input = "px-4  py-2\n  rounded";
    assert.equal(rewriteClassList(input).output, input);
  });

  it("applies only the requested rules", () => {
    assert.equal(rewriteClassList("bg-red-50 text-[var(--error)]", ["token-text"]).output, "bg-red-50 text-danger");
  });

  it("flags a hue it cannot parse instead of skipping it", () => {
    const result = rewriteClassList("data-[state=open]:bg-red-50");
    assert.equal(result.output, "data-[state=open]:bg-red-50");
    assert.equal(result.review.length, 1);
  });
});
