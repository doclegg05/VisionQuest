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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run as runDay1 } from "./journey-day1.mjs";
import { run as runTeacherLoop } from "./journey-teacher-loop.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function loadFixture(name) {
  return JSON.parse(
    readFileSync(path.join(REPO_ROOT, "config/benchmarks/fixtures", `${name}.json`), "utf8"),
  );
}

/** A ctx whose report lives in a scratch directory, so runs cannot collide. */
function ctxFor(fixtureName, report) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "bench-journey-"));
  const fixture = loadFixture(fixtureName);
  if (report !== undefined) {
    const full = path.join(repoRoot, fixture.reportPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(report));
  }
  return { repoRoot, fixture };
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
  it("skips when the spec has not run, and says how to run it", async () => {
    const result = await runDay1(ctxFor("journey-day1"));
    assert.equal(result.metrics, undefined);
    assert.match(result.skipped, /no run report/u);
    assert.match(result.skipped, /bench-journey-day1\.spec\.ts/u);
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
  it("skips when the spec has not run", async () => {
    const result = await runTeacherLoop(ctxFor("journey-teacher-loop"));
    assert.match(result.skipped, /bench-journey-teacher-loop\.spec\.ts/u);
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
