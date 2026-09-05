#!/usr/bin/env node
/**
 * Tests for the two journey scorers, driven from synthetic run reports.
 *
 * These matter more than usual: the collectors need a browser, a server and a
 * database, none of which the authoring worktree had, so this file is where
 * the gates are shown to fail. Every case is a report shape the specs could
 * actually produce.
 *
 * Not picked up by `npm test` (its glob is src/**) — run directly:
 *   npx tsx --test scripts/bench/suites/journey-day1.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildResult, validateResult } from "../lib/result.mjs";
import { run as runDay1 } from "./journey-day1.mjs";
import { run as runTeacherLoop } from "./journey-teacher-loop.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

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
function ctxFor(suiteName, report, env = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "bench-journey-"));
  const config = loadJson("config/benchmarks", `${suiteName}.json`);
  const fixture = loadJson("config/benchmarks/fixtures", `${suiteName}.json`);
  if (report !== undefined) {
    const full = path.join(repoRoot, fixture.reportPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(report));
  }
  return { repoRoot, config, fixture, suite: suiteName, env };
}

/** The environment the CI collection step presents: browser, server, database. */
const COLLECTOR_ENV = {
  playwright: "1",
  baseUrl: "http://localhost:3000",
  databaseUrl: "postgresql://localhost:5432/x",
};

/**
 * Assert a scorer's return value is something the RUNNER can carry, by
 * pushing it through the runner's own `buildResult` + `validateResult`.
 *
 * Checking `Array.isArray(output.metrics)` here would only restate the
 * assertion; running the real validator is what proves the shape survives the
 * path that rejected it in CI.
 */
function assertRunnerAccepts(suiteName, output) {
  assert.ok(output, "the scorer returned nothing");
  assert.ok(Array.isArray(output.metrics), "run(ctx) must resolve to { metrics: [...] }");
  const config = loadJson("config/benchmarks", `${suiteName}.json`);
  const result = buildResult({
    suite: suiteName,
    tier: config.tier,
    startedAt: new Date().toISOString(),
    durationMs: 1,
    commit: null,
    host: { os: "linux", cpus: 1, memGb: 1, node: process.version },
    metrics: output.metrics.map((metric) => ({
      ...metric,
      unit: config.metrics.find((declared) => declared.id === metric.id)?.unit,
      status: metric.value === null ? "skipped" : "info",
    })),
    status: "skipped",
  });
  assert.deepEqual(validateResult(result), [], "the runner's schema rejected the result");
  return result;
}

function metric(result, id) {
  return result.metrics.find((entry) => entry.id === id);
}

const GOOD_DAY1 = {
  completed: 1,
  studentTaps: 11,
  totalSeconds: 42.5,
  stepCount: 8,
  stepsWithNextSignal: 8,
  steps: [
    { key: "sign_in", seconds: 4.1, nextSignal: true },
    { key: "welcome", seconds: 1.2, nextSignal: true },
    { key: "meet_sage", seconds: 0.9, nextSignal: true },
    { key: "first_orientation_win", seconds: 2.0, nextSignal: true },
    { key: "path_choice", seconds: 9.4, nextSignal: true },
    { key: "first_sage_message", seconds: 5.0, nextSignal: true },
    { key: "dashboard_next_step", seconds: 6.2, nextSignal: true },
    { key: "first_goal", seconds: 8.3, nextSignal: true },
  ],
  sageStubbed: true,
  viewport: "375x812",
  measuredAt: "2026-09-05T12:00:00.000Z",
};

describe("journey-day1", () => {
  // --- the missing-report contract ---------------------------------------
  //
  // This is the path CI failed on: the scorer returned a bare `{ skipped }`
  // and the runner could only say "run(ctx) must resolve to { metrics: [...] }"
  // — a complaint about the return type in place of the fact that the
  // collector never ran. Both branches are pinned, for both scorers.

  it("returns runner-shaped metrics, not a bare object, when the report is missing", async () => {
    const result = await runDay1(ctxFor("journey-day1"));
    assertRunnerAccepts("journey-day1", result);
    assert.equal(result.skipped, undefined, "a bare { skipped } is the bug this pins");
  });

  it("reports every DECLARED metric as null when the report is missing", async () => {
    // Per declared id, because the runner errors on any declared metric the
    // scorer did not return — a partial list would trade one error for another.
    const config = loadJson("config/benchmarks", "journey-day1.json");
    const result = await runDay1(ctxFor("journey-day1"));
    assert.deepEqual(
      result.metrics.map((metric) => metric.id),
      config.metrics.map((metric) => metric.id),
    );
    for (const metric of result.metrics) {
      assert.equal(metric.value, null);
      assert.equal(metric.details.skipped, true);
      assert.match(metric.details.reason, /no run report/u);
      assert.match(metric.details.reason, /bench-journey-day1\.spec\.ts/u);
    }
  });

  it("THROWS when browser+server+database are available but the report is missing", async () => {
    // The CI case. A collector that could have run and did not is a real
    // failure, so the runner must record `status: "error"` rather than a row
    // of nulls that reads like "nothing to see here".
    await assert.rejects(
      () => runDay1(ctxFor("journey-day1", undefined, COLLECTOR_ENV)),
      (error) => {
        assert.match(error.message, /journey-day1/u);
        assert.match(error.message, /browser\+server are available/u);
        assert.match(error.message, /bench-journey-day1\.spec\.ts/u);
        return true;
      },
    );
  });

  it("THROWS on a stale report too, rather than scoring last week's run", async () => {
    const ctx = ctxFor("journey-day1", GOOD_DAY1, COLLECTOR_ENV);
    const full = path.join(ctx.repoRoot, ctx.fixture.reportPath);
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    utimesSync(full, old, old);
    await assert.rejects(
      () => runDay1(ctx),
      (error) => {
        assert.match(error.message, /run report is 72\.0 h old \(limit 24 h\)/u);
        return true;
      },
    );
  });

  it("scores a complete run", async () => {
    const result = await runDay1(ctxFor("journey-day1", GOOD_DAY1));
    assert.equal(metric(result, "completed").value, 1);
    assert.equal(metric(result, "steps_with_next_signal").value, 8);
    assert.equal(metric(result, "student_taps").value, 11);
    assert.equal(metric(result, "total_seconds").value, 42.5);
  });

  it("fails `completed` when the spec did not finish", async () => {
    const result = await runDay1(ctxFor("journey-day1", { ...GOOD_DAY1, completed: 0 }));
    assert.equal(metric(result, "completed").value, 0);
  });

  it("names the steps with no next signal and drops the count below its floor", async () => {
    const steps = GOOD_DAY1.steps.map((step) =>
      step.key === "dashboard_next_step" ? { ...step, nextSignal: false } : step,
    );
    const result = await runDay1(
      ctxFor("journey-day1", { ...GOOD_DAY1, steps, stepsWithNextSignal: 7 }),
    );
    assert.equal(metric(result, "steps_with_next_signal").value, 7);
    assert.deepEqual(metric(result, "steps_with_next_signal").details.missing, [
      "dashboard_next_step",
    ]);
  });

  it("refuses to credit a SHORTENED journey — 6 of 6 is not 8 of 8", async () => {
    // The failure this exists for: a spec that quietly drops two steps would
    // otherwise report full marks and read as an improvement.
    const short = {
      ...GOOD_DAY1,
      stepCount: 6,
      stepsWithNextSignal: 6,
      steps: GOOD_DAY1.steps.slice(0, 6),
    };
    const result = await runDay1(ctxFor("journey-day1", short));
    assert.equal(metric(result, "completed").value, 0);
    assert.equal(metric(result, "steps_with_next_signal").value, 0);
    assert.equal(metric(result, "completed").details.stepCountMatches, false);
  });

  it("reports the slowest steps so a regression names itself", async () => {
    const result = await runDay1(ctxFor("journey-day1", GOOD_DAY1));
    const slowest = metric(result, "total_seconds").details.slowestSteps;
    assert.equal(slowest[0].key, "path_choice");
    assert.equal(slowest.length, 3);
  });

  it("carries the design's proposed floor into details rather than enforcing it", async () => {
    const result = await runDay1(ctxFor("journey-day1", GOOD_DAY1));
    assert.equal(metric(result, "student_taps").details.designFloor, 8);
  });

  it("puts no student identifier or free text from the page into details", async () => {
    const result = await runDay1(ctxFor("journey-day1", GOOD_DAY1));
    const serialized = JSON.stringify(result.metrics);
    for (const forbidden of ["e2e-journey-student", "@test.local", "Become a certified welder"]) {
      assert.ok(!serialized.includes(forbidden), `details leaked ${forbidden}`);
    }
  });
});

const GOOD_LOOP = {
  completed: 1,
  teacherTaps: 5,
  queueToActionSeconds: 12.7,
  totalSeconds: 18.4,
  stepCount: 4,
  steps: [
    { key: "queue", seconds: 5.0 },
    { key: "open_student", seconds: 3.2 },
    { key: "record_action", seconds: 4.5 },
    { key: "return_to_queue", seconds: 5.7 },
  ],
  action: "case_note",
  measuredAt: "2026-09-05T12:00:00.000Z",
};

describe("journey-teacher-loop", () => {
  // The suite CI actually named in its failure. Same three pins as day-1's:
  // the shape, the per-declared-id nulls, and the throw when the collector
  // could have run.

  it("returns runner-shaped metrics, not a bare object, when the report is missing", async () => {
    const result = await runTeacherLoop(ctxFor("journey-teacher-loop"));
    assertRunnerAccepts("journey-teacher-loop", result);
    assert.equal(result.skipped, undefined, "a bare { skipped } is the bug this pins");
  });

  it("reports every DECLARED metric as null when the report is missing", async () => {
    const config = loadJson("config/benchmarks", "journey-teacher-loop.json");
    const result = await runTeacherLoop(ctxFor("journey-teacher-loop"));
    assert.deepEqual(
      result.metrics.map((metric) => metric.id),
      config.metrics.map((metric) => metric.id),
    );
    for (const metric of result.metrics) {
      assert.equal(metric.value, null);
      assert.equal(metric.details.skipped, true);
      assert.match(metric.details.reason, /bench-journey-teacher-loop\.spec\.ts/u);
    }
  });

  it("THROWS when browser+server+database are available but the report is missing", async () => {
    await assert.rejects(
      () => runTeacherLoop(ctxFor("journey-teacher-loop", undefined, COLLECTOR_ENV)),
      (error) => {
        assert.match(error.message, /journey-teacher-loop/u);
        assert.match(error.message, /browser\+server are available/u);
        assert.match(error.message, /bench-journey-teacher-loop\.spec\.ts/u);
        return true;
      },
    );
  });

  it("scores a complete loop", async () => {
    const result = await runTeacherLoop(ctxFor("journey-teacher-loop", GOOD_LOOP));
    assert.equal(metric(result, "completed").value, 1);
    assert.equal(metric(result, "teacher_taps").value, 5);
    assert.equal(metric(result, "queue_to_action_seconds").value, 12.7);
    assert.equal(metric(result, "completed").details.action, "case_note");
  });

  it("fails `completed` when the loop did not close", async () => {
    // Three steps means the instructor never got back to the queue — the
    // thing that makes it a loop.
    const result = await runTeacherLoop(
      ctxFor("journey-teacher-loop", {
        ...GOOD_LOOP,
        stepCount: 3,
        steps: GOOD_LOOP.steps.slice(0, 3),
      }),
    );
    assert.equal(metric(result, "completed").value, 0);
    assert.equal(metric(result, "completed").details.stepCountMatches, false);
  });

  it("carries the design's proposed tap floor into details rather than enforcing it", async () => {
    const result = await runTeacherLoop(ctxFor("journey-teacher-loop", GOOD_LOOP));
    assert.equal(metric(result, "teacher_taps").details.designFloor, 6);
  });
});
