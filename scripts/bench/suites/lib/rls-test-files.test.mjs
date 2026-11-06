import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRlsTestPaths, readRlsTestPaths, extractItBlocksFromFiles } from "./rls-test-files.mjs";
import { extractItBlocks } from "./rls-parse.mjs";

test("parseRlsTestPaths: takes every test file the script names, ignoring the runner", () => {
  assert.deepEqual(parseRlsTestPaths("tsx --test src/lib/a.test.ts src/lib/b.test.ts"), [
    "src/lib/a.test.ts",
    "src/lib/b.test.ts",
  ]);
});

test("readRlsTestPaths: reads the test:rls script from package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "vq-rls-pkg-"));
  try {
    const pkg = join(dir, "package.json");
    writeFileSync(pkg, JSON.stringify({ scripts: { "test:rls": "tsx --test x.test.ts y.test.ts" } }));
    assert.deepEqual(readRlsTestPaths(pkg), ["x.test.ts", "y.test.ts"]);
    writeFileSync(pkg, JSON.stringify({ scripts: {} }));
    assert.throws(() => readRlsTestPaths(pkg), /no "test:rls" script/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the repo's own test:rls script names rls.test.ts and org-tree-rls.test.ts", () => {
  const paths = readRlsTestPaths();
  assert.ok(paths.includes("src/lib/rls.test.ts"));
  assert.ok(paths.includes("src/lib/org-tree-rls.test.ts"));
});

test("extractItBlocksFromFiles: merges the it() blocks of two files", () => {
  const files = {
    "a.ts": 'it("one", async () => { assert.equal(1, 1); });',
    "b.ts": 'it("two", async () => { assert.equal(2, 2); });',
  };
  const blocks = extractItBlocksFromFiles(["a.ts", "b.ts"], extractItBlocks, (p) => files[p]);
  assert.deepEqual(
    blocks.map((b) => b.title),
    ["one", "two"],
  );
});
