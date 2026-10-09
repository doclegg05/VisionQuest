import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { undersizedTargets, unlabelledFields } from "./jsx-hig-checks";

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
