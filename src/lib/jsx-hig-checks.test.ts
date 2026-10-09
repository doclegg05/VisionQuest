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

  it("judges each conditional branch on its own, whatever the order", () => {
    const src = [
      "<button className={compact ? \"py-1 text-sm\" : \"py-3 text-sm\"}>A</button>",
      "<button className={compact ? \"py-3 text-sm\" : \"py-1 text-sm\"}>B</button>",
      "<button className={`rounded ${open ? \"min-h-11 px-4\" : \"px-2 py-1 text-xs\"}`}>C</button>",
      "<button className={`px-4 ${big && \"py-3\"} py-1 text-sm`}>D</button>",
      "<button className={compact ? \"min-h-11 py-1\" : \"py-3 text-sm\"}>E</button>",
    ].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1, 2, 3, 4]);
  });

  it("does not credit min-height on an inline link, where the browser ignores it", () => {
    const src = [
      `<a href="/x" className="min-h-11 text-sm">Inline</a>`,
      `<Link href="/x" className="inline-flex min-h-11 items-center text-sm">Box</Link>`,
      `<button className="min-h-11 text-sm">Button</button>`,
    ].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1]);
  });

  it("knows .primary-button and .secondary-button render as inline-flex", () => {
    const src = [
      `<Link href="/x" className="primary-button min-h-11 px-4 py-2.5 text-sm">Go</Link>`,
      `<a href="/y" className="secondary-button min-h-11 text-sm">Go</a>`,
    ].join("\n");
    assert.deepEqual(undersizedTargets("f.tsx", src), []);
  });

  it("keeps the literal classes of a template constant that has runtime parts", () => {
    const src = [
      "const shared = `block rounded ${tone}`;",
      "export function A() { return <a href=\"/x\" className={`${shared} min-h-11`}>Card</a>; }",
    ].join("\n");
    assert.deepEqual(undersizedTargets("f.tsx", src), []);
  });

  it("credits min-height on a link that is a flex or grid child, which the browser blockifies", () => {
    const src = [
      `<div className="flex gap-2"><Link href="/x" className="min-w-0 flex-1 min-h-11">Row</Link></div>`,
      `<div className="grid"><a href="/y" className="pointer-coarse:min-h-11 px-2 py-1 text-xs">Cell</a></div>`,
      `<p className="text-sm"><Link href="/z" className="min-h-11">Inline</Link></p>`,
      `<div className="flex">{show && <Link href="/w" className="min-h-11" />}</div>`,
    ].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [3]);
  });

  it("treats a fixed height under 44px as the height, whatever the padding", () => {
    const src = [`<button className="h-8 px-3 py-3 text-sm">Fixed</button>`, `<button className="size-10 p-3">Icon</button>`].join("\n");
    assert.deepEqual(lines(undersizedTargets("f.tsx", src)), [1, 2]);
  });

  it("reads a class constant built from other constants in a template literal", () => {
    const src = [
      'const ROW = "inline-flex items-center pointer-coarse:min-h-11 px-2 py-1 text-xs";',
      'const SMALL = "px-2 py-1 text-xs";',
      "const ROW_DELETE = `${ROW} text-red`;",
      "const SMALL_DELETE = `${SMALL} text-red`;",
      "export function A() { return <><button className={ROW_DELETE}>Ok</button><button className={SMALL_DELETE}>No</button></>; }",
    ].join("\n");
    assert.equal(undersizedTargets("f.tsx", src).length, 1);
  });

  it("flags a button with no className at all", () => {
    assert.deepEqual(lines(undersizedTargets("f.tsx", `<button onClick={go}>Save</button>`)), [1]);
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

  it("does not count display: contents as a fix, since such an element takes no margin", () => {
    const src = `<div className="space-y-2"><span className="contents">A</span><p>B</p></div>`;
    assert.deepEqual(lines(inlineSpacedChildren("f.tsx", src)), [1]);
  });

  it("ignores parents without space-y", () => {
    assert.deepEqual(inlineSpacedChildren("f.tsx", `<label className="flex gap-2"><span>A</span><input /></label>`), []);
  });
});
