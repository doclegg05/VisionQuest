#!/usr/bin/env node
/**
 * Benchmark suite: SMS template reading grade and GSM-7 segment fit.
 *
 * config/benchmarks/sms-readability.json — gate, no `requires` (pure
 * function calls against src/lib/nudges/sms-policy-shared.ts, no DB/server).
 *
 * Renders every SMS template builder with every realistic value in the
 * fixture (long employer names, long job titles) and scores each rendered
 * body with the production Flesch-Kincaid function
 * (fleschKincaidGrade, src/lib/sage/readability.ts) and against the real
 * GSM-7 character set (GSM7_BASIC, exported from sms-policy-shared.ts for
 * this purpose — never a second, driftable copy of the set).
 *
 * Contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md):
 *   run(ctx) -> { metrics: [{ id, value, n, details }] }
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const FIXTURE_PATH = join(REPO_ROOT, "config/benchmarks/fixtures/sms-readability.json");
const SMS_POLICY_PATH = join(REPO_ROOT, "src/lib/nudges/sms-policy-shared.ts");
const READABILITY_PATH = join(REPO_ROOT, "src/lib/sage/readability.ts");

/** Cartesian product of arrays, as an array of tuples. */
function cartesian(...arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]],
  );
}

function isGsm7Safe(body, gsm7Set) {
  for (const char of body) {
    if (!gsm7Set.has(char)) return false;
  }
  return true;
}

export async function run(ctx) {
  const fixture = ctx?.fixture ?? JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const [smsPolicy, readability] = await Promise.all([
    import(SMS_POLICY_PATH),
    import(READABILITY_PATH),
  ]);
  const {
    buildWeeklyJobsSms,
    buildInterviewConfirmSms,
    buildInterviewDeclineAckSms,
    buildHeardBackSms,
    buildRetentionSms,
    buildNotificationSms,
    GSM7_BASIC,
    SmsBodyTooLongError,
  } = smsPolicy;
  const { fleschKincaidGrade } = readability;
  const gsm7Set = new Set(GSM7_BASIC.split(""));

  const renders = [];

  for (const count of fixture.counts) {
    renders.push({ template: "buildWeeklyJobsSms", args: { count }, fn: () => buildWeeklyJobsSms(count) });
  }

  for (const [employerName, when, place] of cartesian(
    fixture.employerNames,
    fixture.whens,
    fixture.places,
  )) {
    renders.push({
      template: "buildInterviewConfirmSms",
      args: { employerName, when, place },
      fn: () => buildInterviewConfirmSms({ employerName, when, place }),
    });
  }

  renders.push({
    template: "buildInterviewDeclineAckSms",
    args: {},
    fn: () => buildInterviewDeclineAckSms(),
  });

  for (const jobTitle of fixture.jobTitles) {
    renders.push({ template: "buildHeardBackSms", args: { jobTitle }, fn: () => buildHeardBackSms(jobTitle) });
  }

  for (const employerName of fixture.employerNames) {
    renders.push({
      template: "buildRetentionSms",
      args: { employerName },
      fn: () => buildRetentionSms(employerName),
    });
  }

  for (const [title, actionUrl] of cartesian(fixture.notificationTitles, fixture.actionUrls)) {
    renders.push({
      template: "buildNotificationSms",
      args: { title, actionUrl },
      fn: () => buildNotificationSms(title, actionUrl),
    });
  }

  const scored = [];
  const overLimit = [];

  for (const render of renders) {
    let body;
    try {
      body = render.fn();
    } catch (err) {
      if (SmsBodyTooLongError && err instanceof SmsBodyTooLongError) {
        overLimit.push({ ...render.args, template: render.template, reason: "too_long", error: err.message });
        continue;
      }
      throw err;
    }

    const grade = fleschKincaidGrade(body);
    const gsm7Safe = isGsm7Safe(body, gsm7Set);
    if (body.length > 160 || !gsm7Safe) {
      overLimit.push({
        template: render.template,
        args: render.args,
        reason: body.length > 160 ? "length" : "non_gsm7_char",
        body,
        length: body.length,
      });
    }
    scored.push({ template: render.template, args: render.args, body, grade, length: body.length });
  }

  const maxEntry = scored.reduce(
    (worst, entry) => (worst === null || entry.grade > worst.grade ? entry : worst),
    null,
  );
  const worst = scored
    .slice()
    .sort((a, b) => b.grade - a.grade)
    .slice(0, 10)
    .map((entry) => ({ template: entry.template, grade: entry.grade, length: entry.length, body: entry.body }));

  return {
    metrics: [
      {
        id: "max_grade",
        value: maxEntry ? maxEntry.grade : 0,
        n: scored.length,
        details: { worst, maxEntry },
      },
      {
        id: "over_160_gsm7",
        value: overLimit.length,
        n: renders.length,
        details: { violations: overLimit },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
  } catch {
    return false;
  }
})();

if (isMainModule && process.argv.includes("--self-test")) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const started = Date.now();
  run({ fixture, fixturePath: FIXTURE_PATH, env: {}, log: console, now: () => new Date() })
    .then((result) => {
      console.log("sms-readability --self-test");
      console.log(`  duration: ${Date.now() - started}ms\n`);
      for (const metric of result.metrics) {
        console.log(`  ${metric.id}: ${metric.value} (n=${metric.n})`);
      }
      console.log("\nWorst-grade renders:");
      for (const entry of result.metrics[0].details.worst.slice(0, 5)) {
        console.log(`  grade ${entry.grade.toFixed(1)}  [${entry.template}]  "${entry.body}"`);
      }
      if (result.metrics[1].value > 0) {
        console.log("\nOver-limit / non-GSM7 renders:");
        for (const v of result.metrics[1].details.violations) {
          console.log(`  [${v.template}] ${v.reason}: ${JSON.stringify(v)}`);
        }
      }
      console.log("\n--self-test: PASS");
    })
    .catch((err) => {
      console.error("--self-test: FAIL");
      console.error(err);
      process.exitCode = 1;
    });
}
