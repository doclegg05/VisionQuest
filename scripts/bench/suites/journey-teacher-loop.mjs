#!/usr/bin/env node
// =============================================================================
// journey-teacher-loop — what the core teacher loop costs.
//
//   queue → the student at the top of it → one recorded action → back
//
// The browser run lives in `e2e/bench-journey-teacher-loop.spec.ts`; this
// scorer reads the report it writes, the same collector/scorer split
// `connect-journey` established.
//
//   completed                 the loop closed, all four steps.        1
//   teacher_taps              controls the instructor pressed.
//   queue_to_action_seconds   opening the queue to the action landing.
//
// The loop is only a loop if it CLOSES. An instructor who has to rebuild their
// place in the queue after every action is doing a different, slower job, and
// that is exactly the kind of regression a pass/fail spec on each surface
// separately cannot see.
//
//   node scripts/bench/suites/journey-teacher-loop.mjs --self-test
// =============================================================================

import { selfTest } from "../lib/self-test.mjs";
import { readRunReportOrExplain } from "./lib/raw-report.mjs";

export async function run(ctx) {
  // Either the report, or a well-formed `{ metrics }` explaining its absence —
  // never a bare object. `run(ctx)` must resolve to `{ metrics: [...] }`, and
  // the first cut of this line returned `{ skipped }`, which is the exact
  // failure CI reported: "run(ctx) must resolve to { metrics: [...] }" in
  // place of "the collector never ran". See lib/raw-report.mjs.
  const read = readRunReportOrExplain(ctx, "journey-teacher-loop");
  if (read.metrics) return read;

  const { report, ageHours } = read;
  const expected = ctx.fixture.expectedStepCount;
  const walked = report.stepCount ?? 0;
  const stepCountMatches = walked === expected;

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
          action: report.action ?? null,
          measuredAt: report.measuredAt ?? null,
          ageHours: Number(ageHours.toFixed(2)),
        },
      },
      {
        id: "teacher_taps",
        value: report.teacherTaps ?? 0,
        n: 1,
        details: {
          designFloor: ctx.fixture.designFloors?.teacherTaps ?? null,
          note: report.note ?? null,
        },
      },
      {
        id: "queue_to_action_seconds",
        value: report.queueToActionSeconds ?? 0,
        n: 1,
        details: { steps: report.steps ?? [], totalSeconds: report.totalSeconds ?? null },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
