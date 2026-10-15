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

  it("applies only the requested rules", () => {
    const { output } = rewriteSource('const a = "bg-red-50 text-[var(--error)]";', "x.ts", ["token-text"]);
    assert.equal(output, 'const a = "bg-red-50 text-danger";');
  });
});
