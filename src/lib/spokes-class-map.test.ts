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
    ["text-gray-500", "text-ink-muted"],
    ["text-slate-900", "text-ink-strong"],
    ["bg-gray-100", "bg-surface-muted"],
    ["border-gray-200", "border-line"],
  ];
  for (const [input, expected] of cases) it(`${input} -> ${expected}`, () => assert.equal(to(input), expected));

  it("deletes dark: hue classes, since role tokens already switch per theme", () => {
    assert.deepEqual(mapClass("dark:bg-red-950/40"), { rule: "hue", to: null });
    assert.equal(rewriteClassList("bg-red-50 dark:bg-red-950/40").output, "bg-danger-soft");
  });

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

const ROLE_OF: Record<string, string> = {
  red: "danger", rose: "danger", pink: "danger", fuchsia: "danger",
  emerald: "success", green: "success", lime: "success",
  amber: "warning", yellow: "warning", orange: "warning",
  blue: "info", sky: "info", cyan: "info", teal: "info",
  indigo: "brand-deep", violet: "brand-deep", purple: "brand-deep",
};

describe("every hue maps to its role", () => {
  for (const [hue, role] of Object.entries(ROLE_OF)) {
    it(`${hue} -> ${role}`, () => {
      assert.equal(to(`bg-${hue}-100`), `bg-${role}-soft`);
      assert.equal(to(`bg-${hue}-600`), `bg-${role}`);
      assert.equal(to(`text-${hue}-700`), `text-${role}`);
      assert.equal(to(`border-${hue}-300`), `border-${role}`);
    });
  }
  for (const neutral of ["slate", "gray", "zinc", "neutral", "stone"]) {
    it(`${neutral} -> ink, surface, and line tokens`, () => {
      assert.equal(to(`text-${neutral}-800`), "text-ink-strong");
      assert.equal(to(`text-${neutral}-500`), "text-ink-muted");
      assert.equal(to(`bg-${neutral}-50`), "bg-surface-muted");
      assert.equal(to(`border-${neutral}-300`), "border-line");
    });
  }
});

describe("hue prefixes and token text beyond the basic table", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["via-red-100", "via-danger-soft"],
    ["to-red-700", "to-danger"],
    ["outline-red-500", "outline-danger"],
    ["divide-red-200", "divide-danger"],
    ["stroke-red-500", "stroke-danger"],
    ["decoration-red-500", "decoration-danger"],
    ["accent-red-500", "accent-danger"],
    ["caret-red-500", "caret-danger"],
    ["shadow-red-500", "shadow-danger"],
    ["border-x-red-500", "border-x-danger"],
    ["border-t-red-500", "border-t-danger"],
    ["text-[var(--accent-red)]", "text-danger"],
    ["text-[var(--success)]", "text-success"],
    ["text-[var(--accent-blue)]", "text-info"],
    ["text-[var(--accent-gold)]", "text-warning"],
  ];
  for (const [input, expected] of cases) it(`${input} -> ${expected}`, () => assert.equal(to(input), expected));
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

  it("keeps the original line breaks and indentation when a multi-line list changes", () => {
    assert.equal(rewriteClassList("px-4\n  bg-red-50\n  py-2").output, "px-4\n  bg-danger-soft\n  py-2");
  });

  it("removes a deleted class together with the whitespace before it", () => {
    assert.equal(rewriteClassList("px-4\n  dark:bg-red-900\n  py-2").output, "px-4\n  py-2");
  });
});

describe("removed dark: colors are reviewed when the dark theme could break", () => {
  it("flags a removed dark: color when the list keeps a fixed light color", () => {
    const result = rewriteClassList("bg-white dark:bg-slate-900 border border-emerald-500");
    assert.equal(result.output, "bg-white border border-success");
    assert.ok(result.review.some((r) => r.token === "dark:bg-slate-900"));
  });

  it("does not flag a removed dark: color when everything else mapped", () => {
    assert.equal(rewriteClassList("bg-red-50 dark:bg-red-950/40").review.length, 0);
  });
});

describe("hover and focus colors that collapse onto their base", () => {
  it("flags a hover color that the mapping made identical to its base", () => {
    const result = rewriteClassList("bg-blue-600 text-white hover:bg-blue-700");
    assert.equal(result.output, "bg-info text-white hover:bg-info");
    assert.ok(result.review.some((r) => r.token === "hover:bg-blue-700"));
  });
});

describe("bracket variants are flagged, never skipped", () => {
  for (const token of ["[&>svg]:rounded-[10px]", "data-[state=open]:text-[var(--error)]", "max-[400px]:text-[11px]"]) {
    it(`${token} comes back unchanged with exactly one review item`, () => {
      const result = rewriteClassList(token);
      assert.equal(result.output, token);
      assert.equal(result.review.length, 1);
    });
  }
});
