import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractImportSpecifiers,
  resolveSpecifier,
  buildReachableSet,
  computeUntestedModules,
} from "./import-graph.mjs";

test("extractImportSpecifiers: static import, side-effect import, export-from, dynamic import, require", () => {
  const source = `
    import { foo } from "@/lib/foo";
    import "./side-effect";
    export { bar } from "../bar";
    export type { Baz } from "@/lib/baz";
    const mod = await import("./lazy");
    const legacy = require("./legacy");
  `;
  const specs = extractImportSpecifiers(source);
  assert.deepEqual(
    specs.sort(),
    ["../bar", "./lazy", "./legacy", "./side-effect", "@/lib/baz", "@/lib/foo"].sort(),
  );
});

test("extractImportSpecifiers: a bare package specifier is captured too (filtering happens at resolve time)", () => {
  const specs = extractImportSpecifiers(`import { z } from "zod";`);
  assert.deepEqual(specs, ["zod"]);
});

test("extractImportSpecifiers: no imports returns an empty list", () => {
  assert.deepEqual(extractImportSpecifiers("export const x = 1;"), []);
});

function withTmpRepo(fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), "vq-import-graph-"));
  try {
    return fn(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("resolveSpecifier: resolves @/ against src/, relative against the importing file's directory", () => {
  withTmpRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "src/lib"), { recursive: true });
    writeFileSync(join(repoRoot, "src/lib/foo.ts"), "export const foo = 1;\n");
    writeFileSync(join(repoRoot, "src/lib/bar.ts"), "export const bar = 1;\n");

    assert.equal(resolveSpecifier("@/lib/foo", "src/lib/entry.ts", repoRoot), "src/lib/foo.ts");
    assert.equal(resolveSpecifier("./bar", "src/lib/entry.ts", repoRoot), "src/lib/bar.ts");
  });
});

test("resolveSpecifier: a bare package specifier resolves to null (external, not part of the graph)", () => {
  withTmpRepo((repoRoot) => {
    assert.equal(resolveSpecifier("react", "src/lib/entry.ts", repoRoot), null);
    assert.equal(resolveSpecifier("node:fs", "src/lib/entry.ts", repoRoot), null);
  });
});

test("resolveSpecifier: a relative import to a directory resolves via its index file", () => {
  withTmpRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "src/lib/widgets"), { recursive: true });
    writeFileSync(join(repoRoot, "src/lib/widgets/index.ts"), "export const w = 1;\n");
    assert.equal(resolveSpecifier("./widgets", "src/lib/entry.ts", repoRoot), "src/lib/widgets/index.ts");
  });
});

test("resolveSpecifier: an unresolvable specifier (file does not exist) returns null", () => {
  withTmpRepo((repoRoot) => {
    assert.equal(resolveSpecifier("./nowhere", "src/lib/entry.ts", repoRoot), null);
  });
});

test("buildReachableSet: BFS follows the import chain transitively through @/ and relative specifiers", () => {
  withTmpRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "src/lib"), { recursive: true });
    writeFileSync(join(repoRoot, "src/lib/a.test.ts"), `import { b } from "@/lib/b";\n`);
    writeFileSync(join(repoRoot, "src/lib/b.ts"), `import { c } from "./c";\n`);
    writeFileSync(join(repoRoot, "src/lib/c.ts"), `export const c = 1;\n`);
    writeFileSync(join(repoRoot, "src/lib/unreached.ts"), `export const u = 1;\n`);

    const reached = buildReachableSet({ rootFiles: ["src/lib/a.test.ts"], repoRoot });
    assert.ok(reached.has("src/lib/a.test.ts"));
    assert.ok(reached.has("src/lib/b.ts"));
    assert.ok(reached.has("src/lib/c.ts"));
    assert.ok(!reached.has("src/lib/unreached.ts"));
  });
});

// The coordinator's requested case: a tiny synthetic tree, two source files,
// one reachable from the (one) test file, one not.
test("computeUntestedModules: on a two-file synthetic tree, the file with no importing test is untested and the other is not", () => {
  withTmpRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, "src/reachable.ts"), "export const reachable = 1;\n");
    writeFileSync(join(repoRoot, "src/unreachable.ts"), "export const unreachable = 1;\n");
    writeFileSync(join(repoRoot, "src/reachable.test.ts"), `import { reachable } from "./reachable";\n`);

    const result = computeUntestedModules({
      eligibleFiles: ["src/reachable.ts", "src/unreachable.ts"],
      testFiles: ["src/reachable.test.ts"],
      repoRoot,
    });

    assert.deepEqual(result.untestedModules, ["src/unreachable.ts"]);
    assert.equal(result.reachableCount, 1);
    assert.equal(result.eligibleCount, 2);
  });
});

test("computeUntestedModules: a file reachable only via @/ import is not reported as untested", () => {
  withTmpRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "src/lib"), { recursive: true });
    writeFileSync(join(repoRoot, "src/lib/foo.ts"), "export const foo = 1;\n");
    writeFileSync(join(repoRoot, "src/lib/foo.test.ts"), `import { foo } from "@/lib/foo";\n`);

    const result = computeUntestedModules({
      eligibleFiles: ["src/lib/foo.ts"],
      testFiles: ["src/lib/foo.test.ts"],
      repoRoot,
    });
    assert.deepEqual(result.untestedModules, []);
  });
});

test("computeUntestedModules: zero test files means every eligible file is untested", () => {
  withTmpRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, "src/lonely.ts"), "export const x = 1;\n");
    const result = computeUntestedModules({
      eligibleFiles: ["src/lonely.ts"],
      testFiles: [],
      repoRoot,
    });
    assert.deepEqual(result.untestedModules, ["src/lonely.ts"]);
  });
});
