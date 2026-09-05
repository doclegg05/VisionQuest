// End-to-end tests for the runner CLI, driven against a throwaway repo root
// (BENCH_REPO_ROOT) so no test ever writes into the real reports/ tree.
//
// The exit-code table under test (contract "CLI"):
//   0  pass / watch / skipped, and any failure outside --compare
//   1  a gate- or nightly-tier fail or error, with --compare
//   2  a config or usage error
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "run.mjs");
const COMPARE = join(HERE, "..", "compare.mjs");

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "bench-run-"));
  mkdirSync(join(root, "config", "benchmarks", "fixtures"), { recursive: true });
  mkdirSync(join(root, "scripts", "bench", "suites"), { recursive: true });
  mkdirSync(join(root, "reports", "benchmarks", "latest"), { recursive: true });
  writeFileSync(join(root, "reports", "benchmarks", "baseline.json"), "{}\n");
  return root;
}

function addSuite(root, name, { tier = "gate", metrics, scorer, fixture = [1, 2, 3], requires = [] }) {
  writeFileSync(
    join(root, "config", "benchmarks", "fixtures", `${name}.json`),
    JSON.stringify(fixture)
  );
  writeFileSync(join(root, "scripts", "bench", "suites", `${name}.mjs`), scorer);
  writeFileSync(
    join(root, "config", "benchmarks", `${name}.json`),
    JSON.stringify(
      {
        suite: name,
        title: `${name} suite`,
        area: "example",
        tier,
        scorer: `scripts/bench/suites/${name}.mjs`,
        fixture: `config/benchmarks/fixtures/${name}.json`,
        requires,
        metrics,
      },
      null,
      2
    )
  );
}

function bench(root, args, extraEnv = {}) {
  return spawnSync(process.execPath, [RUN, ...args], {
    encoding: "utf8",
    env: { ...process.env, BENCH_REPO_ROOT: root, ...extraEnv },
  });
}

function readResult(root, name) {
  return JSON.parse(readFileSync(join(root, "reports", "benchmarks", "latest", `${name}.json`), "utf8"));
}

function readBaseline(root) {
  return JSON.parse(readFileSync(join(root, "reports", "benchmarks", "baseline.json"), "utf8"));
}

const passingScorer = `
export async function run(ctx) {
  if (!Array.isArray(ctx.fixture)) throw new Error("fixture not loaded");
  return { metrics: [{ id: "accuracy", value: 1, n: ctx.fixture.length }] };
}
`;

const failingScorer = `
export async function run() {
  return { metrics: [{ id: "accuracy", value: 0.1, n: 10 }] };
}
`;

const throwingScorer = `
export async function run() {
  throw new Error("scorer exploded");
}
`;

const metrics = [{ id: "accuracy", unit: "ratio", direction: "higher", floor: 0.9, tolerance: 0.02 }];

test("--list prints the discovered suites and exits 0", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: passingScorer });
    const out = bench(root, ["--list"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /demo/);
    assert.match(out.stdout, /gate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a passing suite exits 0 and writes a result file with the ctx-driven metric", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: passingScorer });
    const out = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(out.status, 0, out.stderr);
    const result = readResult(root, "demo");
    assert.equal(result.suite, "demo");
    assert.equal(result.status, "pass");
    assert.equal(result.metrics[0].value, 1);
    assert.equal(result.metrics[0].n, 3, "ctx.fixture was parsed and handed to the scorer");
    assert.equal(result.metrics[0].unit, "ratio");
    assert.equal(result.metrics[0].floor, 0.9);
    assert.ok(typeof result.durationMs === "number");
    assert.ok(result.host && typeof result.host.node === "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a gate suite under its floor fails the run with --compare and passes without it", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: failingScorer });
    const compared = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(compared.status, 1, compared.stdout + compared.stderr);
    assert.equal(readResult(root, "demo").status, "fail");
    const uncompared = bench(root, ["--suite=demo"]);
    assert.equal(uncompared.status, 0, "without --compare the runner only measures");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a watch-tier suite under its floor reports fail but never fails the run", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { tier: "watch", metrics, scorer: failingScorer });
    const out = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(readResult(root, "demo").status, "fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nightly-tier suite under its floor does fail the run with --compare", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { tier: "nightly", metrics, scorer: failingScorer });
    assert.equal(bench(root, ["--suite=demo", "--compare"]).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unmet requires mark the suite skipped and exit 0", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: failingScorer, requires: ["gemini"] });
    const out = bench(root, ["--suite=demo", "--compare"], { GEMINI_API_KEY: "" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const result = readResult(root, "demo");
    assert.equal(result.status, "skipped");
    assert.match(result.skipped, /GEMINI_API_KEY/);
    assert.equal(result.metrics[0].status, "skipped");
    assert.equal(result.metrics[0].value, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a scorer that throws records status error and fails the run with --compare", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: throwingScorer });
    const out = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(out.status, 1);
    const result = readResult(root, "demo");
    assert.equal(result.status, "error");
    assert.match(result.error, /scorer exploded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a configured metric the scorer never returned is an error, not a silent pass", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", {
      metrics: [
        ...metrics,
        { id: "coverage", unit: "ratio", direction: "higher", floor: 0.6 },
      ],
      scorer: passingScorer,
    });
    const out = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    const result = readResult(root, "demo");
    assert.equal(result.status, "error");
    assert.match(result.error, /coverage/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--tier selects every suite of that tier whose requires are met", () => {
  const root = makeRepo();
  try {
    addSuite(root, "one", { metrics, scorer: passingScorer });
    addSuite(root, "two", { tier: "watch", metrics, scorer: passingScorer });
    const out = bench(root, ["--tier=gate", "--compare"]);
    assert.equal(out.status, 0, out.stderr);
    assert.ok(existsSync(join(root, "reports", "benchmarks", "latest", "one.json")));
    assert.ok(!existsSync(join(root, "reports", "benchmarks", "latest", "two.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--json prints machine-readable results on stdout", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: passingScorer });
    const out = bench(root, ["--suite=demo", "--json"]);
    assert.equal(out.status, 0, out.stderr);
    const parsed = JSON.parse(out.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].suite, "demo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--update-baseline without --reason is refused and leaves the baseline alone", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: passingScorer });
    const out = bench(root, ["--suite=demo", "--update-baseline"]);
    assert.equal(out.status, 2);
    assert.match(out.stderr + out.stdout, /--reason/);
    assert.deepEqual(readBaseline(root), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--update-baseline --reason writes value, commit, host and reason", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: passingScorer });
    const out = bench(root, [
      "--suite=demo",
      "--update-baseline",
      "--reason=initial measurement",
    ]);
    assert.equal(out.status, 0, out.stderr);
    const baseline = readBaseline(root);
    assert.equal(baseline.demo.accuracy.value, 1);
    assert.equal(baseline.demo.accuracy.reason, "initial measurement");
    assert.equal(typeof baseline.demo.accuracy.measuredAt, "string");
    assert.equal(typeof baseline.demo.accuracy.host, "string");
    assert.ok("commit" in baseline.demo.accuracy);
    assert.ok("provider" in baseline.demo.accuracy);
    assert.ok("model" in baseline.demo.accuracy);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a baseline is read back on the next run and drives the watch verdict", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", {
      metrics: [{ id: "accuracy", unit: "ratio", direction: "higher", floor: 0.5, tolerance: 0.01 }],
      scorer: `export async function run() { return { metrics: [{ id: "accuracy", value: 0.8 }] }; }`,
    });
    writeFileSync(
      join(root, "reports", "benchmarks", "baseline.json"),
      JSON.stringify({ demo: { accuracy: { value: 0.99, reason: "seeded" } } })
    );
    const out = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(out.status, 0, "a watch is not a failure");
    const result = readResult(root, "demo");
    assert.equal(result.metrics[0].status, "watch");
    assert.equal(result.metrics[0].baseline, 0.99);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an owner-documented floorless gate metric reports info and never fails the run", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", {
      metrics: [
        {
          id: "accuracy",
          unit: "count",
          direction: "lower",
          floor: null,
          reason: "budget is an owner decision; recorded until Britt sets one",
          displayUnit: "usd",
        },
      ],
      scorer: `export async function run() { return { metrics: [{ id: "accuracy", value: 4200 }] }; }`,
    });
    const out = bench(root, ["--suite=demo", "--compare"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const result = readResult(root, "demo");
    assert.equal(result.status, "info");
    assert.equal(result.metrics[0].status, "info");
    assert.equal(result.metrics[0].floor, null);
    assert.equal(result.metrics[0].displayUnit, "usd", "displayUnit passes through untouched");
    assert.match(result.metrics[0].reason, /owner decision/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("usage and config errors exit 2", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: passingScorer });
    assert.equal(bench(root, []).status, 2, "neither --suite nor --tier");
    assert.equal(bench(root, ["--suite=nope"]).status, 2, "unknown suite");
    assert.equal(bench(root, ["--tier=someday"]).status, 2, "unknown tier");

    writeFileSync(join(root, "config", "benchmarks", "bad.json"), "{ oops");
    assert.equal(bench(root, ["--suite=demo"]).status, 2, "an unparseable config stops the run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compare.mjs re-reads the written results and applies the same verdict", () => {
  const root = makeRepo();
  try {
    addSuite(root, "demo", { metrics, scorer: failingScorer });
    bench(root, ["--suite=demo"]);
    const compare = spawnSync(process.execPath, [COMPARE], {
      encoding: "utf8",
      env: { ...process.env, BENCH_REPO_ROOT: root },
    });
    assert.equal(compare.status, 1, compare.stdout + compare.stderr);
    assert.match(compare.stdout, /demo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compare.mjs exits 0 when there is nothing to compare", () => {
  const root = makeRepo();
  try {
    const compare = spawnSync(process.execPath, [COMPARE], {
      encoding: "utf8",
      env: { ...process.env, BENCH_REPO_ROOT: root },
    });
    assert.equal(compare.status, 0, compare.stdout + compare.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
