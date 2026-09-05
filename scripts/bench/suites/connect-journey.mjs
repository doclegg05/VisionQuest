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

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { benchRepoRoot, isSelfTest, selfTest } from "../lib/self-test.mjs";

const SUITE = "connect-journey";

export async function run(ctx) {
  const reportPath = path.join(benchRepoRoot(), ctx.fixture.reportPath);

  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch {
    return {
      skipped:
        `no run report at ${ctx.fixture.reportPath} — run the spec first:\n  ` +
        ctx.fixture.howToRun.join("\n  "),
    };
  }

  const report = JSON.parse(raw);

  const ageHours = (Date.now() - statSync(reportPath).mtimeMs) / (60 * 60 * 1000);
  const maxAge = ctx.fixture.maxReportAgeHours ?? Infinity;
  if (ageHours > maxAge) {
    return {
      skipped:
        `the run report is ${ageHours.toFixed(1)} h old (limit ${maxAge} h). ` +
        "Scoring it would report a result from an older commit as this one's. " +
        `Re-run:\n  ${ctx.fixture.howToRun.join("\n  ")}`,
    };
  }

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

if (isSelfTest(import.meta.url)) await selfTest(SUITE, run);
