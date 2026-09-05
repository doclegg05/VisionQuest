// =============================================================================
// Reading a browser collector's run report.
//
// Two of this phase's suites are scored from a JSON file a Playwright spec
// wrote (`journey-day1`, `journey-teacher-loop`), the shape
// `connect-journey` established: the spec walks the running app and records,
// the scorer reads and judges, and the benchmark runner never has to start a
// browser.
//
// The age check is the part worth having in one place. A STALE report must be
// treated as absent, because a green `completed: 1` from last week reported
// against today's commit is a passing gate that measured nothing — worse than
// no number, since it reads as proof.
// =============================================================================

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * @param {object} ctx the scorer ctx (needs `repoRoot` and `fixture`)
 * @returns {{ report: object, ageHours: number } | { skipped: string }}
 */
export function readRunReport(ctx) {
  const reportPath = path.join(ctx.repoRoot, ctx.fixture.reportPath);
  const howToRun = (ctx.fixture.howToRun ?? []).join("\n  ");

  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch {
    return {
      skipped: `no run report at ${ctx.fixture.reportPath} — run the spec first:\n  ${howToRun}`,
    };
  }

  const ageHours = (Date.now() - statSync(reportPath).mtimeMs) / (60 * 60 * 1000);
  const maxAge = ctx.fixture.maxReportAgeHours ?? Infinity;
  if (ageHours > maxAge) {
    return {
      skipped:
        `the run report is ${ageHours.toFixed(1)} h old (limit ${maxAge} h). ` +
        "Scoring it would report a result from an older commit as this one's. " +
        `Re-run:\n  ${howToRun}`,
    };
  }

  return { report: JSON.parse(raw), ageHours };
}
