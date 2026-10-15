// src/lib/spokes-source-rewrite.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteSource } from "../../scripts/lib/spokes-source-rewrite.mjs";

describe("rewriteSource", () => {
  it("rewrites a JSX className", () => {
    const { output } = rewriteSource('const a = <p className="px-2 text-red-600">Oops</p>;', "x.tsx");
    assert.equal(output, 'const a = <p className="px-2 text-danger">Oops</p>;');
  });

  it("rewrites clsx object keys", () => {
    const { output } = rewriteSource('cn({ "bg-red-50": isError, "px-2": true });', "x.ts");
    assert.equal(output, 'cn({ "bg-danger-soft": isError, "px-2": true });');
  });

  it("rewrites the static pieces of a template literal", () => {
    const { output } = rewriteSource("const c = `px-2 ${size} bg-red-50`;", "x.ts");
    assert.equal(output, "const c = `px-2 ${size} bg-danger-soft`;");
  });

  it("lists a class built from a template expression for review", () => {
    const { output, review } = rewriteSource("const c = `bg-${tone}-100`;", "x.ts");
    assert.equal(output, "const c = `bg-${tone}-100`;");
    assert.equal(review.length, 1);
    assert.match(review[0].reason, /template expression/);
  });

  it("leaves prose alone", () => {
    const source = 'const t = "Use the red pen on page 500";';
    assert.equal(rewriteSource(source, "x.ts").output, source);
  });

  it("reports one-based line numbers", () => {
    const { changes } = rewriteSource('const a = 1;\nconst b = "bg-red-50";', "x.ts");
    assert.deepEqual(changes, [{ line: 2, from: "bg-red-50", to: "bg-danger-soft" }]);
  });

  it("reports a change inside a multi-line template at the line of its own token", () => {
    const { changes } = rewriteSource("const a = `px-2\n  bg-red-50`;", "x.ts");
    assert.deepEqual(changes, [{ line: 2, from: "bg-red-50", to: "bg-danger-soft" }]);
  });

  it("applies only the requested rules", () => {
    const { output } = rewriteSource('const a = "bg-red-50 text-[var(--error)]";', "x.ts", ["token-text"]);
    assert.equal(output, 'const a = "bg-red-50 text-danger";');
  });
});

describe("rewriteSource: template-built classes are reviewed, never skipped", () => {
  const built = [
    "const c = `border-l-${t}-500`;",
    "const c = `shadow-${t}-500/20`;",
    "const c = `outline-${t}`;",
    "const c = `bg-red-5${n}`;",
  ];
  for (const source of built) {
    it(`${source} stays unchanged and gets a review item`, () => {
      const { output, review } = rewriteSource(source, "x.ts");
      assert.equal(output, source);
      assert.ok(review.length >= 1, source);
    });
  }
});

describe("rewriteSource: a class touching a template expression", () => {
  it("never rewrites a class the expression can extend, and reviews it", () => {
    const source = "const c = `bg-red-50${s}`;";
    const { output, review } = rewriteSource(source, "x.ts");
    assert.equal(output, source);
    assert.ok(review.some((r) => r.token === "bg-red-50"));
  });

  it("still rewrites classes that are separated from the expression by whitespace", () => {
    const { output } = rewriteSource("const c = `p-2 bg-red-50 ${s}`;", "x.ts");
    assert.equal(output, "const c = `p-2 bg-danger-soft ${s}`;");
  });

  it("never rewrites a leading class the expression before it can extend, and reviews it", () => {
    const source = "const c = `${a}bg-red-50 p-2`;";
    const { output, review } = rewriteSource(source, "x.ts");
    assert.equal(output, source);
    assert.ok(review.some((r) => r.token === "bg-red-50"));
  });
});

describe("rewriteSource: one file with several edits", () => {
  it("rewrites a JSX className, a clsx key, and a template tail together", () => {
    const source = [
      'const a = <p className="px-2 text-red-600">Oops</p>;',
      'cn({ "bg-red-50": isError });',
      "const c = `p-2 ${size} bg-red-50`;",
    ].join("\n");
    const expected = [
      'const a = <p className="px-2 text-danger">Oops</p>;',
      'cn({ "bg-danger-soft": isError });',
      "const c = `p-2 ${size} bg-danger-soft`;",
    ].join("\n");
    assert.equal(rewriteSource(source, "x.tsx").output, expected);
  });
});
