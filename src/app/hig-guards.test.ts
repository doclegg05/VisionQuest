import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { inlineSpacedChildren, undersizedTargets, unlabelledFields, type JsxViolation } from "@/lib/jsx-hig-checks";

/**
 * App-wide HIG guards (HIG review Phase 2, 2026-10-09).
 *
 * Every button and link reaches 44pt on a touch screen: `min-h-11`, or
 * `pointer-coarse:min-h-11` to keep a compact look under a mouse (D-25, E-27,
 * E-33, E-38). Every input, select, and textarea has a label a screen reader
 * can announce; a placeholder disappears on typing and is not one (D-23, E-26).
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(join(ROOT, "src"))
  .filter((f) => f.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(f))
  .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, "utf8") }));

function report(check: (fileName: string, text: string) => JsxViolation[]): string[] {
  return files.flatMap(({ file, text }) => check(file, text).map((v) => `${file}:${v.line} <${v.element}> ${v.detail}`));
}

describe("HIG guards", () => {
  it("checks the app's components", () => {
    assert.ok(files.length > 200, `expected the app's .tsx files, found ${files.length}`);
  });

  it("every button and link reaches 44pt on touch", () => {
    assert.deepEqual(report(undersizedTargets), []);
  });

  it("every form field has a label", () => {
    assert.deepEqual(report(unlabelledFields), []);
  });

  it("label text in a spaced stack actually gets its spacing", () => {
    assert.deepEqual(report(inlineSpacedChildren), []);
  });
});
