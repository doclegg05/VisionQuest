// =============================================================================
// Reading a browser collector's run report.
//
// Two of this phase's suites are scored from a JSON file a Playwright spec
// wrote (`journey-day1`, `journey-teacher-loop`), the shape `connect-journey`
// established: the spec walks the running app and records, the scorer reads
// and judges, and the benchmark runner never has to start a browser.
//
// TWO THINGS LIVE HERE, and the second one is the one that broke.
//
// 1. The age check. A STALE report must be treated as absent, because a green
//    `completed: 1` from last week reported against today's commit is a
//    passing gate that measured nothing — worse than no number, since it
//    reads as proof.
//
// 2. The SHAPE a scorer may return when the report is not there. `run(ctx)`
//    must resolve to `{ metrics: [...] }` — both the runner (run.mjs:191) and
//    `--self-test` enforce it — so a bare `{ skipped }` object is a contract
//    violation, not a graceful degradation. The first cut returned exactly
//    that, and CI said so: `FAIL journey-teacher-loop — run(ctx) must resolve
//    to { metrics: [...] }`. A missing collector report surfaced as an
//    unreadable complaint about the scorer's return type instead of the plain
//    fact that the collector never ran.
//
// So the branching is `axe-authenticated`'s, which had this right already:
//
//   requirements MET, report missing   -> THROW, naming the collector spec.
//       The environment says a browser and a server were available, so the
//       collector could have run and did not. That is a real failure, and the
//       runner records it as `status: "error"`.
//   requirements UNMET, report missing -> return every declared metric with
//       `value: null` and `details.skipped`. Nothing could have collected it,
//       so there is nothing to fail; the runner reads null as "no value".
//
// In practice the runner checks `requires` itself and skips the suite before
// calling the scorer at all, so the second branch is reached only by a direct
// call — a unit test, or a scorer run by hand. It exists so that call is well
// formed rather than throwing something confusing.
// =============================================================================

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Everything these suites need before they can score: a browser, a running
 * server, and the database the collector logs into.
 *
 * Read off `ctx.env` rather than `process.env` so a caller can drive it, and
 * so it agrees with what the runner already resolved.
 */
export function collectorRequirementsMet(ctx) {
  const env = ctx?.env ?? {};
  return Boolean(env.playwright) && Boolean(env.baseUrl) && Boolean(env.databaseUrl);
}

/**
 * One null-valued metric per metric the suite CONFIG declares.
 *
 * Per declared id, not per metric the scorer happens to know about: the runner
 * errors on any declared metric the scorer did not return ("a declared metric
 * that never reports would otherwise pass silently"), so the config is the
 * only correct source for this list.
 */
export function unavailableMetrics(ctx, reason) {
  const declared = ctx?.config?.metrics ?? [];
  if (declared.length === 0) {
    // No config to enumerate means this is not a real suite run. Say so rather
    // than inventing a metric id that no config declares.
    throw new Error(`${reason} (and ctx.config declares no metrics to report it against)`);
  }
  return {
    metrics: declared.map((metric) => ({
      id: metric.id,
      value: null,
      n: 0,
      details: { skipped: true, reason },
    })),
  };
}

/**
 * Read the collector's run report.
 *
 * @param {object} ctx the scorer ctx (needs `repoRoot` and `fixture`)
 * @returns {{ report: object, ageHours: number } | { unavailable: string }}
 *   `unavailable` carries the reason; the caller decides whether that is a
 *   throw or a null-metrics return, via `collectorRequirementsMet`.
 */
export function readRunReport(ctx) {
  const reportPath = path.join(ctx.repoRoot, ctx.fixture.reportPath);
  const howToRun = (ctx.fixture.howToRun ?? []).join("\n  ");

  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch {
    return {
      unavailable: `no run report at ${ctx.fixture.reportPath} — run the spec first:\n  ${howToRun}`,
    };
  }

  const ageHours = (Date.now() - statSync(reportPath).mtimeMs) / (60 * 60 * 1000);
  const maxAge = ctx.fixture.maxReportAgeHours ?? Infinity;
  if (ageHours > maxAge) {
    return {
      unavailable:
        `the run report is ${ageHours.toFixed(1)} h old (limit ${maxAge} h). ` +
        "Scoring it would report a result from an older commit as this one's. " +
        `Re-run:\n  ${howToRun}`,
    };
  }

  return { report: JSON.parse(raw), ageHours };
}

/**
 * The whole missing-report decision in one call, so both journey scorers make
 * it identically.
 *
 * Returns `{ report, ageHours }` to score, or a `{ metrics }` object the
 * scorer returns as-is; throws when the collector should have run and did not.
 */
export function readRunReportOrExplain(ctx, suiteName) {
  const read = readRunReport(ctx);
  if (!read.unavailable) return read;

  if (collectorRequirementsMet(ctx)) {
    throw new Error(`${suiteName}: browser+server are available but ${read.unavailable}`);
  }
  return unavailableMetrics(ctx, read.unavailable);
}
