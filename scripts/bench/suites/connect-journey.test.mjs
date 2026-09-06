#!/usr/bin/env node
/**
 * Tests for the connect-journey scorer, driven from synthetic run reports.
 *
 * The missing-report cases matter most. The collector needs a browser, a
 * server and a database, none of which the authoring worktree had, so this
 * file is where that path is shown to behave — and it is the path CI actually
 * failed on: the scorer returned a bare `{ skipped }` and the runner could
 * only say "run(ctx) must resolve to { metrics: [...] }", a complaint about
 * this file's return type in place of the fact that the collector never ran.
 *
 * Shape and helpers deliberately match `journey-day1.test.mjs`: the three
 * journey scorers now share one decision (`lib/raw-report.mjs`), so their
 * tests should be readable side by side and fail the same way.
 *
 * Not picked up by `npm test` (its glob is src/**) — run directly, or via
 * `npm run bench:suites:test`:
 *   npx tsx --test scripts/bench/suites/connect-journey.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildResult, validateResult } from "../lib/result.mjs";
import { run as runConnectJourney } from "./connect-journey.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SUITE = "connect-journey";

function loadJson(...segments) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, ...segments), "utf8"));
}

/**
 * A ctx whose report lives in a scratch directory, so runs cannot collide.
 *
 * It carries the suite's real `config` and an `env`, because both are load-
 * bearing on the missing-report path: the config supplies the declared metric
 * ids, and the env decides between throwing and returning nulls.
 */
function ctxFor(report, env = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "bench-connect-journey-"));
  const config = loadJson("config/benchmarks", `${SUITE}.json`);
  const fixture = loadJson("config/benchmarks/fixtures", `${SUITE}.json`);
  if (report !== undefined) {
    const full = path.join(repoRoot, fixture.reportPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(report));
  }
  return { repoRoot, config, fixture, suite: SUITE, env };
}

/** The environment the CI collection step presents: browser, server, database. */
const COLLECTOR_ENV = {
  playwright: "1",
  baseUrl: "http://localhost:3000",
  databaseUrl: "postgresql://localhost:5432/x",
};

/**
 * Assert a scorer's return value is something the RUNNER can carry, by pushing
 * it through the runner's own `buildResult` + `validateResult`.
 *
 * Checking `Array.isArray(output.metrics)` here would only restate the
 * assertion; running the real validator is what proves the shape survives the
 * path that rejected it in CI.
 */
function assertRunnerAccepts(output) {
  assert.ok(output, "the scorer returned nothing");
  assert.ok(Array.isArray(output.metrics), "run(ctx) must resolve to { metrics: [...] }");
  const config = loadJson("config/benchmarks", `${SUITE}.json`);
  const result = buildResult({
    suite: SUITE,
    tier: config.tier,
    config,
    output,
    startedAt: new Date().toISOString(),
    durationMs: 1,
    env: {},
  });
  validateResult(result, config);
  return result;
}

/** What the spec writes on a clean end-to-end run. */
const GOOD_RUN = {
  completed: 1,
  studentTaps: 2,
  elapsedMs: 23_815,
  connectionId: "cbenchconn01",
  measuredAt: new Date().toISOString(),
  note: "approve, then confirm",
};

describe("connect-journey", () => {
  // --- the missing-report contract ---------------------------------------

  it("returns runner-shaped metrics, not a bare object, when the report is missing", async () => {
    const result = await runConnectJourney(ctxFor());
    assertRunnerAccepts(result);
    assert.equal(result.skipped, undefined, "a bare { skipped } is the bug this pins");
  });

  it("reports every DECLARED metric as null when the report is missing", async () => {
    // Per declared id, because the runner errors on any declared metric the
    // scorer did not return — a partial list would trade one error for another.
    const config = loadJson("config/benchmarks", `${SUITE}.json`);
    const result = await runConnectJourney(ctxFor());
    assert.deepEqual(
      result.metrics.map((metric) => metric.id),
      config.metrics.map((metric) => metric.id),
    );
    for (const metric of result.metrics) {
      assert.equal(metric.value, null);
      assert.equal(metric.details.skipped, true);
      assert.match(metric.details.reason, /no run report/u);
      assert.match(metric.details.reason, /bench-connect-journey\.spec\.ts/u);
    }
  });

  it("THROWS when browser+server+database are available but the report is missing", async () => {
    // The CI case. A collector that could have run and did not is a real
    // failure, so the runner must record `status: "error"` rather than a row
    // of nulls that reads like "nothing to see here".
    await assert.rejects(
      () => runConnectJourney(ctxFor(undefined, COLLECTOR_ENV)),
      (error) => {
        assert.match(error.message, /connect-journey/u);
        assert.match(error.message, /browser\+server are available/u);
        assert.match(error.message, /bench-connect-journey\.spec\.ts/u);
        return true;
      },
    );
  });

  it("THROWS on a stale report too, rather than scoring last week's run", async () => {
    // A green `completed: 1` from an earlier run, reported against today's
    // commit, is a passing gate that measured nothing — worse than no number,
    // because it reads as proof.
    const ctx = ctxFor(GOOD_RUN, COLLECTOR_ENV);
    const full = path.join(ctx.repoRoot, ctx.fixture.reportPath);
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    utimesSync(full, old, old);
    await assert.rejects(
      () => runConnectJourney(ctx),
      (error) => {
        assert.match(error.message, /run report is 72\.0 h old \(limit 24 h\)/u);
        return true;
      },
    );
  });

  // --- scoring a report that IS there -------------------------------------

  it("scores a complete run", async () => {
    const result = await runConnectJourney(ctxFor(GOOD_RUN));
    assertRunnerAccepts(result);
    const byId = Object.fromEntries(result.metrics.map((m) => [m.id, m.value]));
    assert.equal(byId.completed, 1);
    assert.equal(byId.student_taps, 2);
    assert.equal(byId.elapsed_ms, 23_815);
  });

  it("fails `completed` when the spec did not finish", async () => {
    // The floor on `completed` is 1, so a half-finished journey has to score 0
    // rather than inheriting a truthy value from a partial report.
    const result = await runConnectJourney(ctxFor({ ...GOOD_RUN, completed: 0 }));
    const completed = result.metrics.find((m) => m.id === "completed");
    assert.equal(completed.value, 0);
  });

  it("does not read a non-1 `completed` as success", async () => {
    // Guards the coercion itself: anything other than exactly 1 is not a
    // finished journey, however truthy it looks.
    for (const value of [true, "1", 2, null, undefined]) {
      const result = await runConnectJourney(ctxFor({ ...GOOD_RUN, completed: value }));
      const completed = result.metrics.find((m) => m.id === "completed");
      assert.equal(completed.value, 0, `completed: ${JSON.stringify(value)} must not score 1`);
    }
  });

  it("carries the report's provenance into details so a number can be traced", async () => {
    const result = await runConnectJourney(ctxFor(GOOD_RUN));
    const completed = result.metrics.find((m) => m.id === "completed");
    assert.equal(completed.details.connectionId, "cbenchconn01");
    assert.equal(completed.details.measuredAt, GOOD_RUN.measuredAt);
    assert.ok(typeof completed.details.ageHours === "number");
  });
});
