#!/usr/bin/env node
// =============================================================================
// nudge-sweep — the hourly sweep, against a real database and a fake Twilio.
//
// config/benchmarks/nudge-sweep.json — gate, `requires: ["postgres","cohort"]`.
// The three in-process nudge suites measure the RULES; this one measures the
// things that only exist once there is a database underneath: the run lock, the
// per-recipient daily cap under a genuine race, and how long a sweep takes at
// its heaviest hour.
//
//   daily_cap_exceeded          rows over SMS_DAILY_CAP for any recipient.   0
//   duplicate_open_questions    recipients left with two open questions.     0
//   concurrent_run_not_skipped  sweeps past the first that were not skipped. 0
//   deadline_overrun_ms         time past the sweep's own wall-clock budget. 0
//   sweep_duration_ms           tracked, no floor (see the config's reason)
//   sends_per_run               tracked, no floor
//
// `deadline_overrun_ms` is measured against the budget the runner sets for
// ITSELF — `RUN_LOCK_TIMEOUT_MS - SEND_DEADLINE_MARGIN_MS`, parsed out of
// src/lib/nudges/schedule.ts rather than restated here. Restating it would let
// the two drift apart silently, and this metric is precisely about the sweep
// and its lock having the same lifetime.
//
// LOCALLY THIS SKIPS. There is no database in the authoring environment (see
// .claude/MEMORY.md, "No local Postgres on this Mac"), so `--self-test` here
// exercises the skip path and nothing else. It runs for real in CI's
// `bench -- --tier=gate --compare` step, after `scripts/bench/seed-cohort.ts`
// has put the cohort into the hermetic pgvector service. That service connects
// as `postgres`, a superuser, so `prismaAdmin` falls back to `DATABASE_URL`
// and the F63 boot probe (`rolbypassrls`) passes without `ADMIN_DATABASE_URL`
// being set — which is why the CI step needs no new environment variable.
//
//   node --import tsx scripts/bench/suites/nudge-sweep.mjs --self-test
// =============================================================================

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const HARNESS = path.join(REPO_ROOT, "scripts", "bench", "harness", "nudge-sweep.ts");
const SCHEDULE_SOURCE = path.join(REPO_ROOT, "src", "lib", "nudges", "schedule.ts");
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The runner's own wall-clock budget, read from its source.
 *
 * Parsed rather than restated: the whole point of the metric is that the
 * sweep's deadline and its lock's timeout are one number, so a copy here that
 * fell behind would report "inside budget" against a budget nobody uses.
 * A missing constant throws — an unparseable source is not a passing gate.
 */
export function readDeadlineBudgetMs(source) {
  const read = (name) => {
    const match = source.match(new RegExp(`const ${name} = ([\\d_]+);`));
    if (!match) {
      throw new Error(
        `could not find ${name} in src/lib/nudges/schedule.ts; this suite measures the ` +
          "runner's own deadline and cannot invent one",
      );
    }
    return Number(match[1].replace(/_/gu, ""));
  };
  return read("RUN_LOCK_TIMEOUT_MS") - read("SEND_DEADLINE_MARGIN_MS");
}

/**
 * `skipped` values that mean the sweep did no work at all.
 *
 * "already running" is NOT one of them — that is the run lock doing its job on
 * the second of two concurrent sweeps. These two are the silent-outage shapes:
 * the feature answers 200, logs one line, and texts nobody. This suite's first
 * real run found exactly that (the advisory-lock overload bug, see the config's
 * notes), which is why it is a gate of its own rather than something a reader
 * is expected to notice in `sends_per_run`.
 */
const BLOCKED_SKIPS = new Set(["run lock unavailable", "admin client not privileged"]);

/** Turn one harness report into the metric values. Pure, so it is testable. */
export function scoreReport(report, budgetMs) {
  const cap = report.capStress ?? { capConsumingRows: 0, dailyCap: 0 };
  const overCapForStressed = Math.max(0, cap.capConsumingRows - cap.dailyCap);
  const overCapForCohort = Math.max(0, (report.perStudentDailyMax ?? 0) - cap.dailyCap);
  return {
    sweep_blocked: (report.allSkipped ?? []).filter((value) => BLOCKED_SKIPS.has(value)).length,
    send_errors: report.sendErrors ?? 0,
    daily_cap_exceeded: overCapForStressed + overCapForCohort,
    duplicate_open_questions: report.duplicateOpenQuestions ?? 0,
    // Of the two sweeps started at once, exactly one may do work. Anything
    // beyond the first that was not skipped means the lock did not hold.
    concurrent_run_not_skipped: Math.max(0, (report.concurrent?.ran ?? 0) - 1),
    deadline_overrun_ms: Math.max(0, (report.sweepDurationMs ?? 0) - budgetMs),
    sweep_duration_ms: report.sweepDurationMs ?? 0,
    sends_per_run: report.sendsPerRun ?? 0,
  };
}

const SKIPPED = {
  sweep_blocked: 0,
  send_errors: 0,
  daily_cap_exceeded: 0,
  duplicate_open_questions: 0,
  concurrent_run_not_skipped: 0,
  deadline_overrun_ms: 0,
  sweep_duration_ms: null,
  sends_per_run: null,
};

function emit(values, n, details) {
  return {
    metrics: Object.entries(values).map(([id, value]) => ({ id, value, n, details })),
  };
}

export async function run(ctx) {
  const budgetMs = readDeadlineBudgetMs(readFileSync(SCHEDULE_SOURCE, "utf8"));
  const databaseUrl = ctx?.env?.databaseUrl ?? process.env.DATABASE_URL ?? null;
  if (!databaseUrl) {
    // The runner's `requires` already skips this suite without a DATABASE_URL;
    // the guard is here too because a scorer is also reachable directly.
    return emit(SKIPPED, 0, { skipped: true, reason: "no DATABASE_URL", budgetMs });
  }

  const child = spawnSync(process.execPath, ["--import", "tsx", HARNESS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(`nudge-sweep harness exited ${child.status}\n${child.stderr || child.stdout}`);
  }
  const lastLine = child.stdout.trim().split("\n").filter(Boolean).pop();
  let report;
  try {
    report = JSON.parse(lastLine ?? "");
  } catch {
    throw new Error(`nudge-sweep harness produced unparseable stdout:\n${child.stdout}`);
  }

  if (!report.ran) {
    // An unseeded cohort is a skip, not a failure: `bench:validate` and CI
    // seed it, and a benchmark that reds a PR because a fixture step was
    // missing teaches everyone to ignore the gate.
    return emit(SKIPPED, 0, { skipped: true, reason: report.reason ?? "unknown", budgetMs });
  }

  const values = scoreReport(report, budgetMs);
  const details = {
    budgetMs,
    firstRun: report.firstRun,
    concurrent: report.concurrent,
    capStress: report.capStress,
    studentsWithSends: report.studentsWithSends,
    twilioCalls: report.twilioCalls,
    note: "Twilio is stubbed; a request to any host other than api.twilio.com throws in the harness.",
  };
  return emit(values, report.studentsWithSends ?? 0, details);
}

await selfTest(import.meta.url, run);
