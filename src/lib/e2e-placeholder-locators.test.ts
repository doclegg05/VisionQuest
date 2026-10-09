import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every Playwright getByPlaceholder() must still match a placeholder in src.
 *
 * HIG Phase 2 moved field names out of placeholders into visible labels, which
 * is right, but two specs that ran outside the PR gate (placement-bridge and
 * the day-1 bench journey) still looked fields up by the old placeholder and
 * would have timed out. This runs in `npm test`, so a label migration that
 * strands a spec fails at once. Use getByLabel for a field's name.
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const placeholders = walk(join(ROOT, "src"))
  .filter((f) => f.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(f))
  .flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/placeholder=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? "",
    ),
  );

const LOCATOR = /getByPlaceholder\(\s*(\/(?:[^/\\\n]|\\.)+\/[a-z]*|"[^"\n]+"|'[^'\n]+')/g;

function stranded(): string[] {
  return walk(join(ROOT, "e2e"))
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(LOCATOR)].flatMap((m) => {
        const literal = m[1];
        const matches = literal.startsWith("/")
          ? placeholders.some((p) =>
              new RegExp(literal.slice(1, literal.lastIndexOf("/")), literal.slice(literal.lastIndexOf("/") + 1)).test(p),
            )
          : placeholders.includes(literal.slice(1, -1));
        const line = text.slice(0, m.index).split("\n").length;
        return matches ? [] : [`${relative(ROOT, file)}:${line} getByPlaceholder(${literal})`];
      });
    });
}

describe("e2e placeholder locators", () => {
  it("finds the app's placeholders", () => {
    assert.ok(placeholders.length > 20, `expected placeholders in src, found ${placeholders.length}`);
  });

  it("every getByPlaceholder still matches a placeholder in src", () => {
    assert.deepEqual(stranded(), []);
  });
});
