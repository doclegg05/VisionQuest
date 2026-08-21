#!/usr/bin/env node

/**
 * Report on the Sage daily-briefing autopilot soak (SagePanel rows).
 *
 * Read-only. For a `--since` window, reports per-day SagePanel counts by
 * status, the percent of active students covered (briefed) each day, and
 * the failure-reason distribution pulled from `SagePanel.meta.failReason`
 * (set by `markFailed` in src/lib/sage/briefing.ts). Ends with a SOAK
 * VERDICT line judged against the charter's promotion bar — see
 * docs/runbooks/sage-briefing-soak.md — >= 95% of active students briefed
 * daily over a trailing 14-day window, zero `tool_violation` failures in
 * that window. The verdict always looks at the trailing 14 UTC days
 * regardless of `--since`; `--since` only controls how much of the daily
 * table gets printed.
 *
 * "Active student" is defined exactly the way the briefing enqueue route
 * selects students (src/app/api/internal/sage/briefing/route.ts):
 * `{ role: "student", isActive: true }`. That query only has a *current*
 * snapshot — there is no historical daily active-student count — so this
 * report uses the current count as the denominator for every day in the
 * window and says so in the output. Treat day-by-day coverage % as an
 * approximation if the active roster has changed size during the window.
 *
 * "Briefed" means the day's SagePanel row reached status "ready". A panel
 * still "generating" when this report runs (mid-job-processor-cycle) does
 * not count as covered yet; run again in a few minutes if the day is
 * still in progress in the current job-processor cycle (job-processor
 * cron runs every 10 minutes — see prisma/migrations/00000000000000_baseline).
 *
 * Degrades honestly when there is nothing to report: an empty window
 * prints "autopilot has never run in this window" instead of a false
 * empty table.
 *
 * Usage:
 *   node scripts/sage-briefing-report.mjs
 *   node scripts/sage-briefing-report.mjs --since=7d
 *   node scripts/sage-briefing-report.mjs --since=24h --json
 *   node scripts/sage-briefing-report.mjs --out=.planning/sage-briefing/report.json
 */

import { PrismaClient } from "@prisma/client";
import { ensureParentDir, loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { writeFileSync } from "node:fs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();

const SINCE_PATTERN = /^(\d+)(h|d)$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Charter promotion bar (docs/plans/2026-08-19-what-better-means-charter.md). */
const SOAK_WINDOW_DAYS = 14;
const SOAK_COVERAGE_TARGET_PCT = 95;

function parseSince(value, fallbackMs) {
  if (!value) return fallbackMs;
  const match = SINCE_PATTERN.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid --since value "${value}" — expected e.g. "24h" or "14d"`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unitMs = match[2].toLowerCase() === "h" ? 60 * 60 * 1000 : DAY_MS;
  return amount * unitMs;
}

/** UTC midnight for the given instant — matches utcPanelDate() in briefing.ts. */
function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

/** Inclusive list of UTC day keys from `from` to `to`. */
function enumerateDayKeys(from, to) {
  const keys = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    keys.push(dayKey(new Date(t)));
  }
  return keys;
}

const STATUS_BUCKETS = ["ready", "generating", "failed", "dismissed"];

function emptyStatusCounts() {
  return Object.fromEntries(STATUS_BUCKETS.map((s) => [s, 0]));
}

/**
 * `meta.failReason` values are written as either a bare reason
 * ("agent_turn_failed") or "<category>:<detail>" (e.g.
 * "tool_violation:find_certification", "invalid_spec:<zod issues>") — see
 * markFailed() call sites in src/lib/sage/briefing.ts. The detail half is
 * often unbounded (raw zod error JSON), so the distribution groups by
 * category only.
 */
function failReasonCategory(failReason) {
  if (!failReason || typeof failReason !== "string") return "unknown";
  const idx = failReason.indexOf(":");
  return idx === -1 ? failReason : failReason.slice(0, idx);
}

function pct(part, total) {
  if (!total) return null;
  return (part / total) * 100;
}

function formatPct(value) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

async function main() {
  const sinceMs = parseSince(args.since, SOAK_WINDOW_DAYS * DAY_MS);
  const soakWindowMs = SOAK_WINDOW_DAYS * DAY_MS;
  // Always fetch at least the trailing 14 days so the SOAK VERDICT is never
  // starved by a narrower --since used for a quick recent-activity check.
  const fetchWindowMs = Math.max(sinceMs, soakWindowMs);

  const now = new Date();
  const today = utcDay(now);
  const tableSince = utcDay(new Date(now.getTime() - sinceMs));
  const soakSince = utcDay(new Date(now.getTime() - soakWindowMs));
  const fetchSince = utcDay(new Date(now.getTime() - fetchWindowMs));

  const activeStudentCount = await prisma.student.count({
    where: { role: "student", isActive: true },
  });

  let rows;
  try {
    rows = await prisma.sagePanel.findMany({
      where: { panelDate: { gte: fetchSince } },
      select: { studentId: true, panelDate: true, status: true, meta: true },
    });
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    if (code === "P2021" || code === "42P01") {
      throw new Error(
        "SagePanel table not found — has `prisma migrate deploy` run against this DATABASE_URL? " +
          `(original error: ${error instanceof Error ? error.message : String(error)})`,
      );
    }
    throw error;
  }

  const byDay = new Map();
  for (const key of enumerateDayKeys(fetchSince, today)) {
    byDay.set(key, { statusCounts: emptyStatusCounts(), failReasons: new Map() });
  }

  for (const row of rows) {
    const key = dayKey(row.panelDate);
    let day = byDay.get(key);
    if (!day) {
      // panelDate outside the enumerated range (clock skew or a stale row) —
      // still count it rather than silently dropping data.
      day = { statusCounts: emptyStatusCounts(), failReasons: new Map() };
      byDay.set(key, day);
    }
    if (Object.prototype.hasOwnProperty.call(day.statusCounts, row.status)) {
      day.statusCounts[row.status] += 1;
    } else {
      day.statusCounts[row.status] = (day.statusCounts[row.status] ?? 0) + 1;
    }
    if (row.status === "failed") {
      const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
      const category = failReasonCategory(meta.failReason);
      day.failReasons.set(category, (day.failReasons.get(category) ?? 0) + 1);
    }
  }

  const sortedDayKeys = [...byDay.keys()].sort();
  const dayReports = sortedDayKeys.map((key) => {
    const day = byDay.get(key);
    const ready = day.statusCounts.ready ?? 0;
    const coveragePct = pct(ready, activeStudentCount);
    const toolViolations = day.failReasons.get("tool_violation") ?? 0;
    return {
      date: key,
      statusCounts: day.statusCounts,
      coveragePct,
      toolViolations,
      failReasons: Object.fromEntries(day.failReasons.entries()),
    };
  });

  const tableDays = dayReports.filter((d) => d.date >= dayKey(tableSince));
  const soakDays = dayReports.filter((d) => d.date >= dayKey(soakSince) && d.date < dayKey(today));

  const totalRows = rows.length;
  const failReasonTotals = new Map();
  for (const row of rows) {
    if (row.status !== "failed") continue;
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const category = failReasonCategory(meta.failReason);
    failReasonTotals.set(category, (failReasonTotals.get(category) ?? 0) + 1);
  }

  // --- SOAK VERDICT --------------------------------------------------
  // Only days with at least one SagePanel row are "evaluable" — a day
  // before autopilot was ever enabled is absence of data, not a coverage
  // failure, and must not silently drag the verdict to FAIL. A real
  // violation (low coverage or a tool_violation) on any evaluable day
  // inside the trailing window DOES fail the bar even if the 14-day
  // window isn't complete yet — the "zero tool_violation" bar can't be
  // un-broken by finishing the remaining days clean.
  let verdict;
  const verdictReasons = [];
  if (totalRows === 0) {
    verdict = "NOT_STARTED";
    verdictReasons.push("no SagePanel rows in this window");
  } else {
    const daysWithData = soakDays.filter((d) => Object.values(d.statusCounts).some((n) => n > 0));
    const evaluableDays = daysWithData.filter((d) => d.coveragePct !== null);
    const belowTarget = evaluableDays.filter((d) => d.coveragePct < SOAK_COVERAGE_TARGET_PCT);
    const totalToolViolations = daysWithData.reduce((acc, d) => acc + d.toolViolations, 0);

    if (belowTarget.length > 0) {
      verdict = "FAIL";
      verdictReasons.push(
        `${belowTarget.length} day(s) below ${SOAK_COVERAGE_TARGET_PCT}% coverage: ${belowTarget
          .map((d) => `${d.date} (${formatPct(d.coveragePct)})`)
          .join(", ")}`,
      );
    }
    if (totalToolViolations > 0) {
      verdict = "FAIL";
      verdictReasons.push(`${totalToolViolations} tool_violation failure(s) in the trailing ${SOAK_WINDOW_DAYS} days`);
    }
    if (!verdict && daysWithData.length < SOAK_WINDOW_DAYS) {
      verdict = "IN_PROGRESS";
      verdictReasons.push(
        `${daysWithData.length}/${SOAK_WINDOW_DAYS} trailing days have SagePanel activity so far, clean — keep soaking`,
      );
    }
    if (!verdict) {
      verdict = "PASS";
      verdictReasons.push(
        `${SOAK_WINDOW_DAYS}/${SOAK_WINDOW_DAYS} trailing days >= ${SOAK_COVERAGE_TARGET_PCT}% coverage, zero tool_violation failures`,
      );
    }
  }

  const report = {
    generatedAt: now.toISOString(),
    since: tableSince.toISOString(),
    sinceWindow: args.since ?? `${SOAK_WINDOW_DAYS}d`,
    activeStudentCount,
    activeStudentCountNote:
      "current snapshot (role=student, isActive=true) — applied as the denominator for every day in the window; there is no historical daily active-student count",
    days: tableDays,
    failReasonTotals: Object.fromEntries(failReasonTotals.entries()),
    soak: {
      windowDays: SOAK_WINDOW_DAYS,
      targetCoveragePct: SOAK_COVERAGE_TARGET_PCT,
      since: soakSince.toISOString(),
      verdict,
      reasons: verdictReasons,
    },
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\nVisionQuest Sage Daily-Briefing Soak Report");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Table window: since ${report.since} (${report.sinceWindow})`);
  console.log(`Active students (current snapshot): ${activeStudentCount}`);
  console.log(`  ${report.activeStudentCountNote}`);

  if (totalRows === 0) {
    console.log(
      "\nNo SagePanel rows in this window — autopilot has never run in this window — is SAGE_AUTOPILOT_ENABLED set?",
    );
  } else {
    console.log("\nBy day (UTC):");
    for (const day of tableDays) {
      const sc = day.statusCounts;
      console.log(
        `  ${day.date}  ready=${sc.ready} generating=${sc.generating} failed=${sc.failed} dismissed=${sc.dismissed}` +
          `  coverage=${formatPct(day.coveragePct)}  tool_violation=${day.toolViolations}`,
      );
      if (Object.keys(day.failReasons).length > 0) {
        const parts = Object.entries(day.failReasons).map(([k, v]) => `${k}=${v}`);
        console.log(`      failReasons: ${parts.join(", ")}`);
      }
    }

    console.log("\nFailure-reason distribution (fetched window):");
    if (failReasonTotals.size === 0) {
      console.log("  none — no failed panels in the fetched window");
    } else {
      for (const [category, count] of [...failReasonTotals.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${category}: ${count}`);
      }
    }
  }

  console.log(
    `\nSOAK VERDICT: ${verdict} (trailing ${SOAK_WINDOW_DAYS} days, target >= ${SOAK_COVERAGE_TARGET_PCT}% coverage, zero tool_violation)`,
  );
  for (const reason of verdictReasons) {
    console.log(`  - ${reason}`);
  }

  if (args.out) {
    console.log(`\nWrote JSON report: ${args.out}`);
  }
}

main()
  .catch((error) => {
    console.error("Briefing report failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
