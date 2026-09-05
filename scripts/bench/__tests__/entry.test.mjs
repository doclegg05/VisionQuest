// Entry-point detection.
//
// A CLI that guards its main() with `import.meta.url === argv[1]` fails OPEN
// through a symlink: Node resolves the module's real path while argv[1] keeps
// the symlink, the comparison is false, main() never runs, and the process
// exits 0. A gate that exits 0 doing nothing is worse than no gate.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { isMainModule } from "../lib/entry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SCORER = join(REPO_ROOT, "scripts", "bench", "suites", "example-smoke.mjs");

test("isMainModule is true when argv[1] is this module", () => {
  const url = pathToFileURL(SCORER).href;
  assert.equal(isMainModule(url, [process.execPath, SCORER]), true);
});

test("isMainModule is false for an imported module", () => {
  const url = pathToFileURL(SCORER).href;
  assert.equal(isMainModule(url, [process.execPath, join(REPO_ROOT, "other.mjs")]), false);
});

test("isMainModule is false when there is no argv[1]", () => {
  assert.equal(isMainModule(pathToFileURL(SCORER).href, [process.execPath]), false);
});

test("isMainModule resolves argv[1] through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-entry-"));
  try {
    const link = join(dir, "linked-scorer.mjs");
    symlinkSync(SCORER, link);
    assert.equal(
      isMainModule(pathToFileURL(SCORER).href, [process.execPath, link]),
      true,
      "the symlink and its target are the same entry point"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a scorer invoked through a symlink still runs its self-test", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-entry-run-"));
  try {
    const link = join(dir, "example-smoke.mjs");
    symlinkSync(SCORER, link);
    const out = spawnSync(process.execPath, [link, "--self-test"], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(
      out.stdout,
      /SELF-TEST example-smoke/,
      `the guard failed open — it exited 0 having done nothing. stdout: ${JSON.stringify(out.stdout)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
