import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inlineSpacedChildren, undersizedTargets, unlabelledFields } from "./jsx-hig-checks";

const lines = (v: { line: number }[]) => v.map((x) => x.line);

describe("undersizedTargets", () => {
  it("flags small-padded buttons and links", () => {
    const src = [
      `<button className="px-3 py-1.5 text-xs">Open</button>`,
      `<Link href="/x" className="p-1.5 rounded">Go</Link>`,
      `<a href="/y" className="text-sm underline">More</a>`,
    ].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1, 2, 3]);
  });

  it("accepts 44px heights, including the touch-only variant", () => {
    const src = [
      `<button className="min-h-11 px-3 py-1.5">A</button>`,
      `<button className="size-11 p-1.5">B</button>`,
      `<button className="h-12 px-2">C</button>`,
      `<button className="min-h-8 pointer-coarse:min-h-11 px-3 py-1">D</button>`,
      `<button className="min-h-[44px] py-1">E</button>`,
    ].join("\n");
    assert.deepEqual(undersizedTargets("f.tsx", src), []);
  });

  it("does not accept heights under 44px", () => {
    const src = `<button className="h-10 w-10 p-1">X</button>`;
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1]);
  });

  it("estimates height from padding, line height, and border, and flags under 44px", () => {
    const src = [
      `<button className="px-4 py-2 text-sm">Save</button>`,
      `<button className="py-3 text-xs">Tiny</button>`,
      `<button className="px-4 py-2 text-sm border">Bordered</button>`,
      `<button className="leading-none text-sm py-3">Tight</button>`,
      `<button className="px-6 text-sm">Wide only</button>`,
    ].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1, 2, 3, 4, 5]);
  });

  it("accepts controls whose estimated height reaches 44px", () => {
    const src = [
      `<button className="px-4 py-2.5 text-base">A</button>`,
      `<button className="px-4 py-2.5 text-sm border-2">B</button>`,
      `<button className="leading-6 py-2.5">C</button>`,
      `<button className="px-3 py-3 text-sm">D</button>`,
    ].join("\n");
    assert.deepEqual(undersizedTargets("f.tsx", src), []);
  });

  it("accepts generous padding without a height class", () => {
    assert.deepEqual(undersizedTargets("f.tsx", `<button className="px-5 py-3">Save</button>`), []);
  });

  it("reads class strings inside template literals and conditionals", () => {
    const src = "<button className={`rounded ${active ? \"py-1\" : \"py-1\"} px-2`}>T</button>";
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1]);
  });

  it("skips a link marked as inline in running text, which WCAG exempts", () => {
    const src = `<p>Read the <a href="/guide" data-inline-link className="underline">orientation guide</a> first.</p>`;
    assert.deepEqual(undersizedTargets("f.tsx", src), []);
  });

  it("does not let a button opt out as an inline link", () => {
    const src = `<button data-inline-link className="py-1">X</button>`;
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1]);
  });

  it("resolves a same-file string constant used in the className", () => {
    const src = [
      'const BUTTON = "inline-flex min-h-11 items-center px-4";',
      'const SMALL = "px-2 py-1";',
      "export function A() { return <><button className={`${BUTTON} border`}>Ok</button><button className={`${SMALL} border`}>No</button></>; }",
    ].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [3]);
    assert.equal(undersizedTargets("f.tsx", src).length, 1);
  });

  it("skips visually hidden and fully dynamic elements", () => {
    const src = [`<a href="#main" className="sr-only focus:not-sr-only">Skip</a>`, `<button className={styles}>D</button>`].join("\n");
    assert.deepEqual(undersizedTargets("f.tsx", src), []);
  });
});

describe("unlabelledFields", () => {
  it("flags placeholder-only and titled fields", () => {
    const src = [
      `<input value={a} placeholder="First name" />`,
      `<select value={b} title="County"><option /></select>`,
      `<textarea placeholder="Notes" />`,
    ].join("\n");
    assert.deepEqual(lines(unlabelledFields("f.tsx", src)), [1, 2, 3]);
  });

  it("accepts aria names, wrapping labels, and htmlFor pairs", () => {
    const src = [
      `<input aria-label="First name" />`,
      `<input aria-labelledby="h1" />`,
      `<label>Birth date <input type="date" /></label>`,
      `<label htmlFor="county">County</label><select id="county"><option /></select>`,
      `<label htmlFor={ids.notes}>Notes</label><textarea id={ids.notes} />`,
    ].join("\n");
    assert.deepEqual(unlabelledFields("f.tsx", src), []);
  });

  it("does not match an htmlFor that points somewhere else", () => {
    const src = `<label htmlFor="other">Other</label><input id="mine" />`;
    assert.deepEqual(lines(unlabelledFields("f.tsx", src)), [1]);
  });

  it("ignores hidden and button-like inputs and fields with spread props", () => {
    const src = [`<input type="hidden" value="x" />`, `<input type="submit" />`, `<input {...field} />`].join("\n");
    assert.deepEqual(unlabelledFields("f.tsx", src), []);
  });
});

describe("inlineSpacedChildren", () => {
  it("flags an inline child of a space-y parent, whose margin never renders", () => {
    const src = `<label className="block space-y-1.5"><span className="text-sm">Start date</span><input type="date" /></label>`;
    assert.deepEqual(lines(inlineSpacedChildren("f.tsx", src)), [1]);
  });

  it("accepts block, flex, and grid children, and the last child", () => {
    const src = [
      `<label className="space-y-1.5"><span className="block text-sm">A</span><input /></label>`,
      `<div className="space-y-2"><span className="flex gap-1">B</span><p>C</p></div>`,
      `<div className="space-y-2"><p>D</p><span>last</span></div>`,
    ].join("\n");
    assert.deepEqual(inlineSpacedChildren("f.tsx", src), []);
  });

  it("ignores parents without space-y", () => {
    assert.deepEqual(inlineSpacedChildren("f.tsx", `<label className="flex gap-2"><span>A</span><input /></label>`), []);
  });
});
