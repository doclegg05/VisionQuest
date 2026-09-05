import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEligibleSourceFiles } from "./source-files.mjs";

test("listEligibleSourceFiles: includes .ts/.tsx, excludes .test.ts(x) and .d.ts, recurses into subdirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "vq-src-files-"));
  try {
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "b.tsx"), "export const B = () => null;\n");
    writeFileSync(join(dir, "a.test.ts"), "// test\n");
    writeFileSync(join(dir, "b.test.tsx"), "// test\n");
    writeFileSync(join(dir, "types.d.ts"), "// types\n");
    writeFileSync(join(dir, "nested", "c.ts"), "export const c = 1;\n");

    const files = listEligibleSourceFiles(dir);
    const basenames = files.map((f) => f.split("/").pop()).sort();
    assert.deepEqual(basenames, ["a.ts", "b.tsx", "c.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listEligibleSourceFiles: a missing root directory returns an empty list, not a thrown error", () => {
  assert.deepEqual(listEligibleSourceFiles("/definitely/does/not/exist/anywhere"), []);
});
