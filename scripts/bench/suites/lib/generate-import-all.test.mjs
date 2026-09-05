import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeImportAllTestFile } from "./generate-import-all.mjs";

test("writeImportAllTestFile: emits a node:test file that imports every listed file by absolute file:// URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "vq-import-all-gen-"));
  try {
    const outFile = join(dir, "generated.test.mjs");
    const failuresOut = join(dir, "failures.json");
    writeImportAllTestFile(["src/lib/foo.ts", "src/app/page.tsx"], outFile, failuresOut);

    const content = readFileSync(outFile, "utf8");
    assert.match(content, /import \{ test \} from "node:test";/);
    assert.match(content, /repoPath: "src\/lib\/foo\.ts"/);
    assert.match(content, /repoPath: "src\/app\/page\.tsx"/);
    // Absolute file:// URLs, not repo-relative bare specifiers (which would
    // resolve against the GENERATED file's own tmpdir location, not the repo).
    assert.match(content, /url: "file:\/\/.*src\/lib\/foo\.ts"/);
    assert.ok(content.includes(`const FAILURES_OUT = ${JSON.stringify(failuresOut)};`));
    // A single import failure must be caught, never rethrown, so one bad
    // module cannot abort every other file's coverage.
    assert.match(content, /catch \(error\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeImportAllTestFile: an empty file list still produces a valid, runnable test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "vq-import-all-gen-empty-"));
  try {
    const outFile = join(dir, "generated.test.mjs");
    writeImportAllTestFile([], outFile, join(dir, "failures.json"));
    const content = readFileSync(outFile, "utf8");
    assert.match(content, /const FILES = \[\s*\];/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
