#!/usr/bin/env node
// =============================================================================
// connect-journey — how much the whole introduction actually costs a student.
//
// The browser run lives in `e2e/bench-connect-journey.spec.ts`; this scorer
// reads the report it writes. Splitting them keeps Playwright out of the
// benchmark runner — the runner starts plain Node, and a suite that needed a
// browser inside it would drag one into every other suite's process.
//
//   completed     the journey finished, all six steps.        exactly 1
//   student_taps  taps the STUDENT made.                      12 or fewer
//   elapsed_ms    wall clock, informational.
//
// `student_taps` counts only the student's side. The instructor proposes and
// sends and the employer answers, and both are real work by other people; the
// design's floor is about what the introduction costs the person with the least
// time and the least reliable internet.
//
// A STALE report is treated as absent. A green `completed: 1` from last week,
// reported against today's commit, is a passing gate that measured nothing —
// worse than no number, because it reads as proof.
//
//   node scripts/bench/suites/connect-journey.mjs --self-test
// =============================================================================

import { readRunReportOrExplain } from "./lib/raw-report.mjs";
import { selfTest } from "../lib/self-test.mjs";

export async function run(ctx) {
  // A bare `{ skipped }` is a CONTRACT VIOLATION, not graceful degradation:
  // the runner requires `{ metrics: [...] }`, so returning it surfaced a
  // missing collector as "run(ctx) must resolve to { metrics: [...] }" — an
  // unreadable complaint about this file's return type instead of the plain
  // fact that the spec never ran. Same bug B6b fixed in the two journey
  // scorers; the decision now lives in one shared helper so the three cannot
  // drift, and it carries the staleness check with it.
  const read = readRunReportOrExplain(ctx, "connect-journey");
  if (read.metrics) return read;
  const { report, ageHours } = read;

  return {
    metrics: [
      {
        id: "completed",
        value: report.completed === 1 ? 1 : 0,
        n: 1,
        details: {
          connectionId: report.connectionId ?? null,
          measuredAt: report.measuredAt ?? null,
          ageHours: Number(ageHours.toFixed(2)),
        },
      },
      {
        id: "student_taps",
        value: report.studentTaps ?? 0,
        n: 1,
        details: { note: report.note ?? null },
      },
      { id: "elapsed_ms", value: report.elapsedMs ?? 0, n: 1 },
    ],
  };
}

await selfTest(import.meta.url, run);
