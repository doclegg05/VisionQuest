import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * --error is a fill. It pairs with --on-error (white) and keeps the same mauve
 * in both themes, so as text on a dark card it measures about 1.5:1. Danger
 * text uses `text-danger`, whose --danger-text turns white in the dark theme;
 * the SPOKES class map (scripts/lib/spokes-class-map.mjs) already rewrites
 * `text-[var(--error)]` to it. The stale-queue warning in PR #249 used --error
 * as text anyway, and every token-pair test stayed green, because they check
 * --on-error on --error and nothing checked what components paint text with.
 */
const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(join(ROOT, "src"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
  .map((f) => ({ file: relative(ROOT, f), lines: readFileSync(f, "utf8").split("\n") }));

/** `text-[var(--error)]` and Tailwind 4's `text-(--error)` shorthand, with any variant or opacity. */
const ERROR_AS_TEXT = /\btext-(?:\[var\(--error\)\]|\(--error\))/;

describe("--error as text", () => {
  it("no component paints text with the --error fill; use text-danger", () => {
    const offenders = files.flatMap(({ file, lines }) =>
      lines.flatMap((line, i) => (ERROR_AS_TEXT.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    assert.deepEqual(offenders, []);
  });
});
