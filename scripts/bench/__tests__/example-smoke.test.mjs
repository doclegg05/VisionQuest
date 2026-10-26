// The example suite exists so the runner is exercised end to end by a suite
// that needs nothing (no DB, no key, no browser). It doubles as the reference
// an author copies, so its shape is pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../suites/example-smoke.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const CONFIG_PATH = join(REPO_ROOT, "config", "benchmarks", "example-smoke.json");
const FIXTURE_PATH = join(REPO_ROOT, "config", "benchmarks", "fixtures", "example-smoke.json");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function ctx() {
  return {
    suite: "example-smoke",
    config,
    fixture,
    fixturePath: FIXTURE_PATH,
    env: { databaseUrl: null, geminiApiKey: null, ollamaHost: null, baseUrl: null },
    log: () => {},
    now: () => new Date("2026-09-05T00:00:00.000Z"),
    repoRoot: REPO_ROOT,
  };
}

test("the example suite needs nothing and sits at watch tier", () => {
  assert.equal(config.suite, "example-smoke");
  assert.equal(config.tier, "watch");
  assert.deepEqual(config.requires, []);
});

test("every configured metric is returned by the scorer", async () => {
  const { metrics } = await run(ctx());
  const returned = metrics.map((m) => m.id).sort();
  const configured = config.metrics.map((m) => m.id).sort();
  assert.deepEqual(returned, configured);
});

test("the score is deterministic across runs", async () => {
  const a = await run(ctx());
  const b = await run(ctx());
  assert.deepEqual(a.metrics, b.metrics);
});

test("the example fixture scores a clean 1.0 so the gate line stays honest", async () => {
  const { metrics } = await run(ctx());
  const accuracy = metrics.find((m) => m.id === "accuracy");
  assert.equal(accuracy.value, 1);
  assert.equal(accuracy.n, fixture.cases.length);
});

test("a wrong expectation in the fixture lowers the score — the scorer really scores", async () => {
  const broken = { ...fixture, cases: [...fixture.cases, { values: [1, 2, 3], p: 50, expected: 999 }] };
  const { metrics } = await run({ ...ctx(), fixture: broken });
  const accuracy = metrics.find((m) => m.id === "accuracy");
  assert.ok(accuracy.value < 1, `expected a drop, got ${accuracy.value}`);
  assert.ok(accuracy.details.failures.length === 1);
});
