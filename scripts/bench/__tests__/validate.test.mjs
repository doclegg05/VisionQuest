// The bench:validate gate. It runs in CI next to the other pipeline
// validators, so it must be filesystem-only (no DB, no network, no scorer
// execution) and it must exit 1 with a readable list, never a stack trace.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, "..", "validate.mjs");
const REPO_ROOT = resolve(HERE, "..", "..", "..");

function validate(root) {
  return spawnSync(process.execPath, [VALIDATE], {
    encoding: "utf8",
    env: { ...process.env, BENCH_REPO_ROOT: root },
  });
}

test("the committed suites in this repo validate", () => {
  const out = validate(REPO_ROOT);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /OVERALL/);
});

test("a gate suite with no floor is rejected with a readable line", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-validate-"));
  try {
    mkdirSync(join(root, "config", "benchmarks"), { recursive: true });
    mkdirSync(join(root, "scripts", "bench", "suites"), { recursive: true });
    mkdirSync(join(root, "reports", "benchmarks"), { recursive: true });
    writeFileSync(join(root, "reports", "benchmarks", "baseline.json"), "{}");
    writeFileSync(
      join(root, "scripts", "bench", "suites", "floorless.mjs"),
      "export async function run() { return { metrics: [] }; }\n"
    );
    writeFileSync(
      join(root, "config", "benchmarks", "floorless.json"),
      JSON.stringify({
        suite: "floorless",
        title: "No floor",
        area: "example",
        tier: "gate",
        scorer: "scripts/bench/suites/floorless.mjs",
        requires: [],
        metrics: [{ id: "a", unit: "ratio", direction: "higher" }],
      })
    );
    const out = validate(root);
    assert.equal(out.status, 1);
    assert.match(out.stdout, /floorless/);
    assert.match(out.stdout, /floor/i);
    assert.doesNotMatch(out.stderr, /at Object\./, "no raw stack trace");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty benchmark directory validates rather than erroring", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-validate-empty-"));
  try {
    mkdirSync(join(root, "config", "benchmarks"), { recursive: true });
    const out = validate(root);
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
