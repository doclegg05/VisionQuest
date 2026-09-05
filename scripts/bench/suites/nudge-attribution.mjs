#!/usr/bin/env node
// =============================================================================
// nudge-attribution — one reply, one question, the right one.
//
// config/benchmarks/nudge-attribution.json — gate, no `requires`: the real
// inbound handler, the real connection pipeline and the real sweep all run
// in-process against the in-memory store in
// scripts/bench/harness/nudge-store.ts.
//
// Every SMS answer this program can receive is one character. Which QUESTION
// that character answers is decided entirely by the outbound log, so the
// failure mode is silent and consequential: a student confirming an interview
// recorded as still employed at a job they left. Four counters, all floor 0
// and all `exact`:
//
//   misattributed_replies    an observed effect the case did not declare
//   second_question_opened   a sweep that stacked a question on an open one
//   direct_followup_writes   an SMS "Y" that wrote SpokesEmploymentFollowUp
//   stop_revocations_incomplete   a STOP that missed a row on the same handset
//
// `direct_followup_writes` pins the 2026-09-05 decision that the retention
// text moves the Connect funnel and raises `connect_retention_confirm` for a
// person, and never touches the grant record — those are two different clocks
// (30/60/90 days from `Connection.startedAt` versus 1/3/6 months from
// `SpokesRecord.unsubsidizedEmploymentAt`) on one shared unique key, so an
// automatic mapping would overwrite a teacher's verified row with a
// self-reported "Y". The store answers `spokesEmploymentFollowUp.upsert` by
// recording the attempt rather than throwing, so a regression is a number here
// instead of a crash somewhere else.
//
//   node --import tsx scripts/bench/suites/nudge-attribution.mjs --self-test
// =============================================================================

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const HARNESS = path.join(REPO_ROOT, "scripts", "bench", "harness", "nudge-attribution.ts");

/** Which counter a mismatch on this key belongs to. */
const KEY_METRIC = {
  prefsRevokedOnRepliedNumber: "stop_revocations_incomplete",
  prefsRevokedElsewhere: "stop_revocations_incomplete",
  questionsOpenedByStudent: "second_question_opened",
  followUpWrites: "direct_followup_writes",
};

function sameValue(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * Compare one case's observation against what it declared.
 *
 * Only declared keys are checked: a case stays about the one thing it is for,
 * and adding an observation to the harness never silently reds unrelated
 * cases. Exported so the red-first unit test can drive it with a wrong
 * observation and watch each counter rise.
 */
export function compareCase(spec, observation) {
  const expected = spec.expect ?? {};
  const findings = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = observation[key];
    if (sameValue(got, want)) continue;
    findings.push({
      case: spec.id,
      key,
      metric: KEY_METRIC[key] ?? "misattributed_replies",
      expected: want,
      actual: got,
    });
  }
  return findings;
}

/**
 * `direct_followup_writes` is counted from EVERY case, not only the ones that
 * declared it: a write on a case that never thought to look for one is exactly
 * the regression this counter exists for.
 */
export function tallyFindings(findings, observations) {
  const counts = {
    misattributed_replies: 0,
    second_question_opened: 0,
    direct_followup_writes: 0,
    stop_revocations_incomplete: 0,
  };
  for (const finding of findings) {
    if (finding.metric === "direct_followup_writes") continue;
    counts[finding.metric] += 1;
  }
  for (const observation of observations) {
    counts.direct_followup_writes += observation.followUpWrites ?? 0;
  }
  return counts;
}

export async function run(ctx) {
  const fixture = ctx.fixture;

  const child = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", HARNESS],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, BENCH_NUDGE_SPEC: JSON.stringify(fixture) },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (child.status !== 0) {
    throw new Error(
      `nudge-attribution harness exited ${child.status}\n${child.stderr || child.stdout}`,
    );
  }
  const lastLine = child.stdout.trim().split("\n").filter(Boolean).pop();
  let payload;
  try {
    payload = JSON.parse(lastLine ?? "");
  } catch {
    throw new Error(`nudge-attribution harness produced unparseable stdout:\n${child.stdout}`);
  }

  const byCase = new Map(payload.observations.map((entry) => [entry.case, entry]));
  const findings = [];
  let checks = 0;
  let replies = 0;

  for (const spec of fixture.cases) {
    const observation = byCase.get(spec.id);
    if (!observation) throw new Error(`the harness returned nothing for case ${spec.id}`);
    checks += Object.keys(spec.expect ?? {}).length;
    replies += (spec.inbound ?? []).length;
    findings.push(...compareCase(spec, observation));
  }

  const counts = tallyFindings(findings, payload.observations);
  const offendersFor = (metric) => findings.filter((finding) => finding.metric === metric).slice(0, 10);
  const shared = { cases: fixture.cases.length, checks, replies };

  return {
    metrics: [
      {
        id: "misattributed_replies",
        value: counts.misattributed_replies,
        n: replies,
        details: { ...shared, offenders: offendersFor("misattributed_replies") },
      },
      {
        id: "second_question_opened",
        value: counts.second_question_opened,
        n: fixture.cases.filter((entry) => entry.sweep).length,
        details: { offenders: offendersFor("second_question_opened") },
      },
      {
        id: "direct_followup_writes",
        value: counts.direct_followup_writes,
        n: fixture.cases.length,
        details: {
          decision:
            "2026-09-05: an SMS retention answer moves the Connect funnel and raises connect_retention_confirm; " +
            "SpokesEmploymentFollowUp is a person's job, on a different clock.",
        },
      },
      {
        id: "stop_revocations_incomplete",
        value: counts.stop_revocations_incomplete,
        n: fixture.cases.filter((entry) => (entry.inbound ?? []).some((m) => /^stop$/i.test(m.body)))
          .length,
        details: { offenders: offendersFor("stop_revocations_incomplete") },
      },
      {
        id: "cases_checked",
        value: checks,
        n: fixture.cases.length,
        details: shared,
      },
    ],
  };
}

await selfTest(import.meta.url, run);
