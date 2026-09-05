#!/usr/bin/env node
/**
 * Tests for axe-authenticated.mjs's requirements-vs-data branching and the
 * "no student data in committed details" security invariant (2026-09-05
 * review).
 *
 * Not picked up by `npm test` (its glob is src/**) — run directly:
 *   npx tsx --test scripts/bench/suites/axe-authenticated.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./axe-authenticated.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SCRATCH_RAW_PATH = join(REPO_ROOT, "reports/benchmarks/raw/axe-authenticated.test-scratch.json");

const SAMPLE_RAW = {
  generatedAt: "2026-09-05T00:00:00.000Z",
  axeTags: ["wcag2a", "wcag2aa"],
  violationsTotal: 2,
  routes: [
    { route: "/dashboard", role: "student", violationCount: 1, violations: [{ id: "color-contrast", impact: "serious", nodeCount: 1 }] },
    // Route shapes must be parameterized, never a resolved student id — this
    // fixture deliberately includes a bad one to prove the test can fail.
    { route: "/teacher/students/:id", role: "teacher", violationCount: 1, violations: [{ id: "button-name", impact: "critical", nodeCount: 1 }] },
  ],
};

function writeScratchRaw() {
  mkdirSync(dirname(SCRATCH_RAW_PATH), { recursive: true });
  writeFileSync(SCRATCH_RAW_PATH, JSON.stringify(SAMPLE_RAW));
}

describe("axe-authenticated — requirements vs. raw-data branching", () => {
  it("SKIPS (no throw) when requirements are unmet and raw data is missing", async () => {
    const result = await run({
      rawDataPath: join(REPO_ROOT, "reports/benchmarks/raw/axe-authenticated.does-not-exist.json"),
      env: { playwright: null, baseUrl: null },
    });
    const metric = result.metrics[0];
    assert.equal(metric.value, null);
    assert.equal(metric.details.skipped, true);
    assert.match(metric.details.reason, /no raw data/);
    assert.match(metric.details.reason, /bench-axe-authenticated\.spec\.ts/);
  });

  it("THROWS when requirements are met (browser+server) but raw data is missing", async () => {
    await assert.rejects(
      () =>
        run({
          rawDataPath: join(REPO_ROOT, "reports/benchmarks/raw/axe-authenticated.does-not-exist.json"),
          env: { playwright: "1", baseUrl: "http://localhost:3000" },
        }),
      (err) => {
        assert.match(err.message, /browser\+server are available/);
        assert.match(err.message, /bench-axe-authenticated\.spec\.ts/);
        return true;
      },
    );
  });

  it("scores normally when raw data is present, regardless of requirements state", async () => {
    writeScratchRaw();
    try {
      const result = await run({ rawDataPath: SCRATCH_RAW_PATH, env: { playwright: null, baseUrl: null } });
      const metric = result.metrics[0];
      assert.equal(metric.value, 2);
      assert.equal(metric.n, 2);
    } finally {
      rmSync(SCRATCH_RAW_PATH, { force: true });
    }
  });
});

describe("axe-authenticated — security: no resolved student id in a committed route", () => {
  it("every route key/value in `details.perRoute` is a route SHAPE, never a resolved student id", async () => {
    writeScratchRaw();
    try {
      const result = await run({ rawDataPath: SCRATCH_RAW_PATH, env: {} });
      const serialized = JSON.stringify(result.metrics[0].details);
      assert.doesNotMatch(
        serialized,
        /\/students\/(?!:id)[a-z0-9]{10,}/i,
        "a route recorded a resolved student id instead of the :id shape",
      );
      // Positive control: the fixture's normalized shape must still be present.
      assert.match(serialized, /\/teacher\/students\/:id/);
    } finally {
      rmSync(SCRATCH_RAW_PATH, { force: true });
    }
  });
});
