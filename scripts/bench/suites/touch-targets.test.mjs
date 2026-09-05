#!/usr/bin/env node
/**
 * Tests for touch-targets.mjs's requirements-vs-data branching and the
 * "no student data in committed details" security invariant (2026-09-05
 * review).
 *
 * Not picked up by `npm test` (its glob is src/**) — run directly:
 *   npx tsx --test scripts/bench/suites/touch-targets.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./touch-targets.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SCRATCH_RAW_PATH = join(REPO_ROOT, "reports/benchmarks/raw/touch-targets.test-scratch.json");

const SAMPLE_RAW = {
  generatedAt: "2026-09-05T00:00:00.000Z",
  viewport: { width: 375, height: 667 },
  minTargetPx: 44,
  routes: ["/dashboard"],
  totalInteractive: 42,
  totalExcluded: 3,
  undersized: [
    {
      route: "/dashboard",
      tag: "button",
      selector: "button#close-icon",
      width: 32,
      height: 32,
      label: "Close, Jamie Rivera's profile card",
    },
  ],
};

function writeScratchRaw() {
  mkdirSync(dirname(SCRATCH_RAW_PATH), { recursive: true });
  writeFileSync(SCRATCH_RAW_PATH, JSON.stringify(SAMPLE_RAW));
}

describe("touch-targets — requirements vs. raw-data branching", () => {
  it("SKIPS (no throw) when requirements are unmet and raw data is missing", async () => {
    const result = await run({
      rawDataPath: join(REPO_ROOT, "reports/benchmarks/raw/touch-targets.does-not-exist.json"),
      env: { playwright: null, baseUrl: null },
    });
    const metric = result.metrics[0];
    assert.equal(metric.value, null);
    assert.equal(metric.details.skipped, true);
    assert.match(metric.details.reason, /no raw data/);
    assert.match(metric.details.reason, /bench-touch-targets\.spec\.ts/);
  });

  it("THROWS when requirements are met (browser+server) but raw data is missing", async () => {
    await assert.rejects(
      () =>
        run({
          rawDataPath: join(REPO_ROOT, "reports/benchmarks/raw/touch-targets.does-not-exist.json"),
          env: { playwright: "1", baseUrl: "http://localhost:3000" },
        }),
      (err) => {
        assert.match(err.message, /browser\+server are available/);
        assert.match(err.message, /bench-touch-targets\.spec\.ts/);
        return true;
      },
    );
  });

  it("scores normally when raw data is present, regardless of requirements state", async () => {
    writeScratchRaw();
    try {
      const result = await run({ rawDataPath: SCRATCH_RAW_PATH, env: { playwright: null, baseUrl: null } });
      const metric = result.metrics[0];
      assert.equal(metric.value, 1);
      assert.equal(metric.n, 42);
      assert.equal(metric.details.violations.length, 1);
    } finally {
      rmSync(SCRATCH_RAW_PATH, { force: true });
    }
  });
});

describe("touch-targets — security: no page text / student data in committed details", () => {
  it("strips `label` from every violation before it reaches `details`", async () => {
    writeScratchRaw();
    try {
      const result = await run({ rawDataPath: SCRATCH_RAW_PATH, env: {} });
      const metric = result.metrics[0];
      for (const violation of metric.details.violations) {
        assert.ok(!("label" in violation), `violation still carries a "label" key: ${JSON.stringify(violation)}`);
        assert.deepEqual(Object.keys(violation).sort(), ["height", "route", "selector", "width"]);
      }
    } finally {
      rmSync(SCRATCH_RAW_PATH, { force: true });
    }
  });

  it("details JSON, stringified, contains no `label` key and no /students/<id> route", async () => {
    writeScratchRaw();
    try {
      const result = await run({ rawDataPath: SCRATCH_RAW_PATH, env: {} });
      const serialized = JSON.stringify(result.metrics[0].details);
      assert.doesNotMatch(serialized, /"label"/);
      assert.doesNotMatch(serialized, /\/students\/[a-z0-9]{10,}/i, "must not embed a resolved student id in a route");
    } finally {
      rmSync(SCRATCH_RAW_PATH, { force: true });
    }
  });
});
