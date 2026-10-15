import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every CSS variable the app reads must be defined somewhere.
 *
 * An undefined var() fails silently: bg-[var(--accent-primary)] compiles to a
 * background that resolves to nothing, so the student's "OK, send it" consent
 * button and three employer buttons rendered white text on no fill. Ten such
 * names were used about 150 times (HIG review B-50, D-10, B-48). Same for
 * Tailwind text sizes: text-3xs and text-2xs generate no CSS (B-39).
 *
 * A var() with a fallback, var(--x, …), is allowed: the fallback renders.
 */

const SRC = join(process.cwd(), "src");
const STOCK_TEXT_SIZES = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SRC)
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
  .map((f) => ({ file: relative(process.cwd(), f), text: readFileSync(f, "utf8") }));

// Definitions count only outside comments, so a token mentioned in prose is not "defined".
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const allText = files.map((f) => stripComments(f.text)).join("\n");
const defined = new Set([
  ...[...allText.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]),
  // next/font exposes its families as CSS variables: `variable: "--font-body"`.
  ...[...allText.matchAll(/variable:\s*["'](--[a-zA-Z0-9-]+)["']/g)].map((m) => m[1]),
]);
const themeTextSizes = new Set([...allText.matchAll(/--text-([a-z0-9]+)\s*:/g)].map((m) => m[1]));

const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

function uses(pattern: RegExp, isBroken: (name: string) => boolean): string[] {
  return files.flatMap(({ file, text }) =>
    text.split("\n").flatMap((line, index) =>
      isComment(line)
        ? []
        : [...line.matchAll(pattern)]
            .map((m) => m[1])
            .filter(isBroken)
            .map((name) => `${file}:${index + 1} ${name}`),
    ),
  );
}

describe("design tokens", () => {
  it("reads only CSS variables that are defined", () => {
    const undefinedVars = uses(/var\((--[a-zA-Z0-9-]+)\s*\)/g, (name) => !defined.has(name));
    assert.deepEqual(undefinedVars, [], "these var() names have no definition and no fallback");
  });

  it("uses only text sizes Tailwind generates", () => {
    const missingSizes = uses(
      /\btext-(\d*xs)\b/g,
      (size) => !STOCK_TEXT_SIZES.has(size) && !themeTextSizes.has(size),
    );
    assert.deepEqual(missingSizes, [], "these text-* sizes produce no CSS");
  });
});
