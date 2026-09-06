// Suite discovery and the five-part config check. `bench:validate` is the
// gate that stops a fixture without a floor from being merged (design §5), so
// each rule gets a case that is red without it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TIERS,
  UNITS,
  DIRECTIONS,
  SCHEMA_FILENAME,
  validateSuiteConfig,
  discoverSuites,
} from "../lib/discover.mjs";

/** Build a throwaway repo root with a benchmark config dir and a scorer. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "bench-discover-"));
  mkdirSync(join(root, "config", "benchmarks", "fixtures"), { recursive: true });
  mkdirSync(join(root, "scripts", "bench", "suites"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "bench", "suites", "demo.mjs"),
    "export async function run(ctx) { return { metrics: [] }; }\n"
  );
  writeFileSync(join(root, "config", "benchmarks", "fixtures", "demo.json"), "[]\n");
  return root;
}

function writeSuite(root, name, config) {
  const path = join(root, "config", "benchmarks", `${name}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

const validConfig = {
  suite: "demo",
  title: "Demo suite",
  area: "example",
  tier: "gate",
  scorer: "scripts/bench/suites/demo.mjs",
  fixture: "config/benchmarks/fixtures/demo.json",
  requires: [],
  metrics: [{ id: "accuracy", unit: "ratio", direction: "higher", floor: 0.9, tolerance: 0.02 }],
};

test("the contract vocabularies are the ones the runner enforces", () => {
  assert.deepEqual([...TIERS].sort(), ["gate", "manual", "nightly", "watch"]);
  assert.deepEqual([...UNITS].sort(), ["count", "grade", "ms", "percent", "ratio", "seconds"]);
  assert.deepEqual([...DIRECTIONS].sort(), ["higher", "lower"]);
  assert.equal(SCHEMA_FILENAME, "result.schema.json");
});

test("a complete config validates with no errors", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(validConfig, {
      path: "config/benchmarks/demo.json",
      repoRoot: root,
    });
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the suite name must match its filename", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      { ...validConfig, suite: "other" },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(errors.some((e) => /suite.*filename/i.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown tier is a config error", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      { ...validConfig, tier: "someday" },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(errors.some((e) => /tier/.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown requires value is a config error", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      { ...validConfig, requires: ["postgres", "hadoop"] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(errors.some((e) => /hadoop/.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing scorer file is a config error", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      { ...validConfig, scorer: "scripts/bench/suites/nope.mjs" },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(errors.some((e) => /scorer/i.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a scorer that does not export run is a config error", () => {
  const root = makeRepo();
  try {
    writeFileSync(
      join(root, "scripts", "bench", "suites", "demo.mjs"),
      "export async function score() { return {}; }\n"
    );
    const { errors } = validateSuiteConfig(validConfig, {
      path: "config/benchmarks/demo.json",
      repoRoot: root,
    });
    assert.ok(errors.some((e) => /export.*run/i.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every documented export form of run is accepted", () => {
  const root = makeRepo();
  const forms = [
    "export async function run(ctx) {}\n",
    "export function run(ctx) {}\n",
    "export const run = async (ctx) => ({ metrics: [] });\n",
    "async function run(ctx) {}\nexport { run };\n",
  ];
  try {
    for (const source of forms) {
      writeFileSync(join(root, "scripts", "bench", "suites", "demo.mjs"), source);
      const { errors } = validateSuiteConfig(validConfig, {
        path: "config/benchmarks/demo.json",
        repoRoot: root,
      });
      assert.deepEqual(errors, [], `rejected: ${source}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a scorer or fixture outside the repository is refused", () => {
  // A suite config is data the runner then EXECUTES. Escaping the checkout
  // turns "add a benchmark" into "run this file", so containment is checked
  // before existence — an absolute path or a `..` escape is refused even when
  // the file is really there.
  const root = makeRepo();
  try {
    const escapes = ["../outside/evil.mjs", "scripts/../../outside/evil.mjs", "/etc/passwd"];
    for (const scorer of escapes) {
      const { errors } = validateSuiteConfig(
        { ...validConfig, scorer },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.ok(
        errors.some((e) => /outside the repository/i.test(e)),
        `${scorer}: ${errors.join("; ")}`
      );
    }
    for (const fixture of escapes) {
      const { errors } = validateSuiteConfig(
        { ...validConfig, fixture },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.ok(
        errors.some((e) => /outside the repository/i.test(e)),
        `${fixture}: ${errors.join("; ")}`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path that only looks like an escape but stays inside is fine", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      { ...validConfig, scorer: "scripts/bench/../bench/suites/demo.mjs" },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declared fixture that does not exist is a config error", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      { ...validConfig, fixture: "config/benchmarks/fixtures/gone.json" },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(errors.some((e) => /fixture/i.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no fixture at all warns but does not block: some suites measure the repo itself", () => {
  const root = makeRepo();
  try {
    const config = { ...validConfig };
    delete config.fixture;
    const { errors, warnings } = validateSuiteConfig(config, {
      path: "config/benchmarks/demo.json",
      repoRoot: root,
    });
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => /fixture/i.test(w)), warnings.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a metric without a unit, or with an unknown one, is a config error", () => {
  const root = makeRepo();
  try {
    const noUnit = validateSuiteConfig(
      { ...validConfig, metrics: [{ id: "a", direction: "higher", floor: 1 }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(noUnit.errors.some((e) => /unit/i.test(e)), noUnit.errors.join("; "));
    const badUnit = validateSuiteConfig(
      { ...validConfig, metrics: [{ id: "a", unit: "furlongs", direction: "higher", floor: 1 }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(badUnit.errors.some((e) => /furlongs/.test(e)), badUnit.errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direction is required unless the metric is exact AND floorless", () => {
  const root = makeRepo();
  try {
    const missing = validateSuiteConfig(
      { ...validConfig, metrics: [{ id: "a", unit: "ratio", floor: 0.9 }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(missing.errors.some((e) => /direction/i.test(e)), missing.errors.join("; "));
    // An exact metric with no floor has nothing to read a direction against.
    const exact = validateSuiteConfig(
      { ...validConfig, tier: "watch", metrics: [{ id: "a", unit: "count", exact: true }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.deepEqual(exact.errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a numeric floor always requires an explicit direction, exact or not", () => {
  // A floor of 0 is unreadable on its own: is 40 comfortably above a minimum,
  // or far past a ceiling? The runner defaults to `higher` when direction is
  // absent, so a missing direction on a ceiling metric passes silently at any
  // value — the same class of bug as the exact-branch floor skip, one layer up.
  const root = makeRepo();
  try {
    for (const metric of [
      { id: "illegal_accepted", unit: "count", floor: 0, exact: true, tolerance: 0 },
      { id: "blocks_fired", unit: "ratio", floor: 1, exact: true },
      { id: "p95_ms", unit: "ms", floor: 500 },
    ]) {
      const { errors } = validateSuiteConfig(
        { ...validConfig, metrics: [metric] },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.ok(
        errors.some((e) => /direction/i.test(e) && /floor/i.test(e)),
        `${metric.id}: ${errors.join("; ")}`
      );
    }

    // Declared explicitly: accepted, both ways.
    for (const direction of ["higher", "lower"]) {
      const { errors } = validateSuiteConfig(
        {
          ...validConfig,
          metrics: [{ id: "a", unit: "count", floor: 0, direction, exact: true }],
        },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.deepEqual(errors, [], direction);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit floorless \"floor\": null does not itself demand a direction", () => {
  // The owner-documented info case: nothing is being judged, so there is no
  // direction to read it in.
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      {
        ...validConfig,
        tier: "watch",
        metrics: [{ id: "a", unit: "count", floor: null, exact: true }],
      },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate and nightly metrics need a floor or exact; watch and manual do not", () => {
  const root = makeRepo();
  try {
    for (const tier of ["gate", "nightly"]) {
      const { errors } = validateSuiteConfig(
        { ...validConfig, tier, metrics: [{ id: "a", unit: "ratio", direction: "higher" }] },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.ok(errors.some((e) => /floor/i.test(e)), `${tier}: ${errors.join("; ")}`);
    }
    for (const tier of ["watch", "manual"]) {
      const { errors } = validateSuiteConfig(
        { ...validConfig, tier, metrics: [{ id: "a", unit: "ratio", direction: "higher" }] },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.deepEqual(errors, [], tier);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a gate metric may omit its floor only as an explicit null plus a reason", () => {
  const root = makeRepo();
  try {
    // The documented escape hatch: "floor": null + a non-empty "reason" makes
    // an owner-documented info metric on a gate or nightly suite.
    for (const tier of ["gate", "nightly"]) {
      const documented = validateSuiteConfig(
        {
          ...validConfig,
          tier,
          metrics: [
            {
              id: "a",
              unit: "count",
              direction: "higher",
              floor: null,
              reason: "budget not set by the owner yet",
            },
          ],
        },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.deepEqual(documented.errors, [], tier);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a null floor without a reason, or an empty reason, is still an error on a gate suite", () => {
  const root = makeRepo();
  try {
    const noReason = validateSuiteConfig(
      { ...validConfig, metrics: [{ id: "a", unit: "count", direction: "higher", floor: null }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(noReason.errors.some((e) => /reason/i.test(e)), noReason.errors.join("; "));

    const blankReason = validateSuiteConfig(
      {
        ...validConfig,
        metrics: [{ id: "a", unit: "count", direction: "higher", floor: null, reason: "  " }],
      },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(blankReason.errors.some((e) => /reason/i.test(e)), blankReason.errors.join("; "));

    // A missing floor KEY (not an explicit null) stays an error even with a
    // reason — the null is the deliberate act the rule asks for.
    const missingKey = validateSuiteConfig(
      { ...validConfig, metrics: [{ id: "a", unit: "count", direction: "higher", reason: "later" }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(missingKey.errors.some((e) => /floor/i.test(e)), missingKey.errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a null floor needs no reason on watch and manual tiers", () => {
  const root = makeRepo();
  try {
    for (const tier of ["watch", "manual"]) {
      const { errors } = validateSuiteConfig(
        { ...validConfig, tier, metrics: [{ id: "a", unit: "count", direction: "higher", floor: null }] },
        { path: "config/benchmarks/demo.json", repoRoot: root }
      );
      assert.deepEqual(errors, [], tier);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non-numeric, non-null floor and a non-string reason are config errors", () => {
  const root = makeRepo();
  try {
    const badFloor = validateSuiteConfig(
      { ...validConfig, metrics: [{ id: "a", unit: "ratio", direction: "higher", floor: "0.9" }] },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(badFloor.errors.some((e) => /floor/i.test(e)), badFloor.errors.join("; "));

    const badReason = validateSuiteConfig(
      {
        ...validConfig,
        metrics: [{ id: "a", unit: "ratio", direction: "higher", floor: 0.9, reason: 42 }],
      },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(badReason.errors.some((e) => /reason/i.test(e)), badReason.errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("displayUnit is accepted as a free string beside the enum unit", () => {
  const root = makeRepo();
  try {
    const ok = validateSuiteConfig(
      {
        ...validConfig,
        metrics: [
          { id: "a", unit: "count", direction: "lower", floor: 100, displayUnit: "usd" },
        ],
      },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.deepEqual(ok.errors, []);

    const bad = validateSuiteConfig(
      {
        ...validConfig,
        metrics: [{ id: "a", unit: "count", direction: "lower", floor: 100, displayUnit: 7 }],
      },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(bad.errors.some((e) => /displayUnit/.test(e)), bad.errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate metric ids are a config error", () => {
  const root = makeRepo();
  try {
    const { errors } = validateSuiteConfig(
      {
        ...validConfig,
        metrics: [
          { id: "a", unit: "ratio", direction: "higher", floor: 0.5 },
          { id: "a", unit: "ratio", direction: "higher", floor: 0.5 },
        ],
      },
      { path: "config/benchmarks/demo.json", repoRoot: root }
    );
    assert.ok(errors.some((e) => /duplicate/i.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a local-model suite must record its host", () => {
  const root = makeRepo();
  try {
    const local = { ...validConfig, requires: ["ollama"] };
    const withoutHost = validateSuiteConfig(local, {
      path: "config/benchmarks/demo.json",
      repoRoot: root,
      baseline: {},
    });
    assert.ok(withoutHost.errors.some((e) => /host/i.test(e)), withoutHost.errors.join("; "));

    const declared = validateSuiteConfig(
      { ...local, host: "recorded" },
      { path: "config/benchmarks/demo.json", repoRoot: root, baseline: {} }
    );
    assert.deepEqual(declared.errors, []);

    const fromBaseline = validateSuiteConfig(local, {
      path: "config/benchmarks/demo.json",
      repoRoot: root,
      baseline: { demo: { accuracy: { value: 0.9, host: "darwin arm64 · 10 cpu · 32 GB" } } },
    });
    assert.deepEqual(fromBaseline.errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverSuites reads every top-level config and ignores the result schema", () => {
  const root = makeRepo();
  try {
    writeSuite(root, "demo", validConfig);
    writeFileSync(
      join(root, "config", "benchmarks", SCHEMA_FILENAME),
      JSON.stringify({ type: "object" })
    );
    const { suites, errors } = discoverSuites({ repoRoot: root });
    assert.deepEqual(errors, []);
    assert.deepEqual(
      suites.map((s) => s.config.suite),
      ["demo"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverSuites orders suites by codepoint, not by locale", () => {
  // `localeCompare` varies with process locale and ICU build, so two machines
  // can list the same suites in different orders and print different tables
  // (the 2026-08-20 rule from the confirm-token canonicalisation work).
  // "Beta" sorts before "alpha" by codepoint (0x42 < 0x61); most locales
  // would put "alpha" first.
  const root = makeRepo();
  try {
    writeSuite(root, "alpha", { ...validConfig, suite: "alpha" });
    writeSuite(root, "Beta", { ...validConfig, suite: "Beta" });
    const { suites, errors } = discoverSuites({ repoRoot: root });
    assert.deepEqual(errors, []);
    assert.deepEqual(
      suites.map((s) => s.name),
      ["Beta", "alpha"].sort() // default Array#sort is codepoint order
    );
    assert.deepEqual(
      suites.map((s) => s.name),
      ["Beta", "alpha"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverSuites reports unparseable JSON instead of throwing", () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, "config", "benchmarks", "broken.json"), "{ not json");
    const { suites, errors } = discoverSuites({ repoRoot: root });
    assert.deepEqual(suites, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /broken\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverSuites does not walk fixture or cohort subdirectories", () => {
  const root = makeRepo();
  try {
    writeSuite(root, "demo", validConfig);
    mkdirSync(join(root, "config", "benchmarks", "synthetic-cohort"), { recursive: true });
    writeFileSync(
      join(root, "config", "benchmarks", "synthetic-cohort", "students.json"),
      "[]"
    );
    const { suites, errors } = discoverSuites({ repoRoot: root });
    assert.deepEqual(errors, []);
    assert.equal(suites.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a duplicate suite name across two files is reported", () => {
  const root = makeRepo();
  try {
    writeSuite(root, "demo", validConfig);
    writeSuite(root, "demo-copy", { ...validConfig, suite: "demo" });
    const { errors } = discoverSuites({ repoRoot: root });
    assert.ok(errors.some((e) => /duplicate suite/i.test(e)), errors.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
