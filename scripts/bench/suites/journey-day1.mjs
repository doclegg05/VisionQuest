#!/usr/bin/env node
// =============================================================================
// journey-day1 — what a student's first session costs, and whether the app
// told them what to do at every step.
//
// The browser run lives in `e2e/bench-journey-day1.spec.ts`; this scorer reads
// the report it writes. Split for the same reason `connect-journey` is split:
// the benchmark runner starts plain Node, and a suite that needed a browser
// inside it would drag one into every other suite's process.
//
//   completed             the first session finished, all eight steps.   1
//   steps_with_next_signal steps where the page named the next action.   8
//   student_taps          controls the student pressed.
//   total_seconds         wall clock, informational.
//
// `steps_with_next_signal` is the one that is a product claim rather than a
// cost. The charter's Phase 2 promise is ONE next signal on every surface; a
// step where the student has to work out what to press is the failure that
// promise exists to prevent, and it is invisible to a pass/fail spec because
// the spec knows where the button is.
//
// It is checked against the report's OWN step count, not only against the
// fixture's: a spec that quietly dropped two steps would otherwise report 6 of
// 6 and look like an improvement.
//
//   node scripts/bench/suites/journey-day1.mjs --self-test
// =============================================================================

import { selfTest } from "../lib/self-test.mjs";
import { readRunReport } from "./lib/raw-report.mjs";

export async function run(ctx) {
  const read = readRunReport(ctx);
  if (read.skipped) return read;

  const { report, ageHours } = read;
  const expected = ctx.fixture.expectedStepCount;
  const walked = report.stepCount ?? 0;

  // A journey that walked a different number of steps than the fixture
  // declares is not this benchmark. Reported as an incomplete run rather than
  // scored, because every other number here is per-step.
  const stepCountMatches = walked === expected;

  const missing = (report.steps ?? [])
    .filter((step) => !step.nextSignal)
    .map((step) => step.key);

  const slowest = [...(report.steps ?? [])]
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0))
    .slice(0, 3)
    .map((step) => ({ key: step.key, seconds: step.seconds }));

  return {
    metrics: [
      {
        id: "completed",
        value: report.completed === 1 && stepCountMatches ? 1 : 0,
        n: 1,
        details: {
          stepCount: walked,
          expectedStepCount: expected,
          stepCountMatches,
          sageStubbed: report.sageStubbed ?? null,
          viewport: report.viewport ?? null,
          measuredAt: report.measuredAt ?? null,
          ageHours: Number(ageHours.toFixed(2)),
        },
      },
      {
        id: "steps_with_next_signal",
        value: stepCountMatches ? (report.stepsWithNextSignal ?? 0) : 0,
        n: expected,
        details: { missing },
      },
      {
        id: "student_taps",
        value: report.studentTaps ?? 0,
        n: 1,
        details: {
          designFloor: ctx.fixture.designFloors?.studentTaps ?? null,
          note: report.note ?? null,
        },
      },
      {
        id: "total_seconds",
        value: report.totalSeconds ?? 0,
        n: 1,
        details: { slowestSteps: slowest, designFloor: ctx.fixture.designFloors?.totalSeconds ?? null },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
