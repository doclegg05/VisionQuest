#!/usr/bin/env node
/**
 * Benchmark suite: SMS template reading grade and segment fit.
 *
 * config/benchmarks/sms-readability.json — gate, no `requires` (pure
 * function calls against src/lib/nudges/sms-policy-shared.ts, no DB/server).
 *
 * Two grade metrics, split on purpose (owner call, 2026-09-05, in reply to
 * this suite's first `watch`-tier measurement):
 *
 *   - fixed_text_max_grade: every template rendered with every caller-
 *     supplied `{value}` slot replaced by a one-syllable placeholder ("X",
 *     or the minimal representative value for a non-string slot) — this
 *     measures the English SENTENCES VisionQuest authored, which is the
 *     thing this program actually controls and can rewrite. Floor 6, gate.
 *   - rendered_max_grade: the same templates rendered with realistic
 *     third-party values (long employer names, long job titles) from the
 *     fixture. `floor: null` in the config — a verbatim job title is not
 *     something copy-editing can fix, so this is tracked, not gated, per
 *     the config's `notes`.
 *
 * over_160_gsm7 is computed from the realistic renders only (fixed-text
 * placeholders are always short and would never stress the segment limit)
 * and stays floor 0, gate.
 *
 * Renders every SMS template builder with every value and scores each
 * rendered body with the production Flesch-Kincaid function
 * (fleschKincaidGrade, src/lib/sage/readability.ts) and against the real
 * GSM-7 character set (GSM7_BASIC, exported from sms-policy-shared.ts for
 * this purpose — never a second, driftable copy of the set).
 *
 * Contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md):
 *   run(ctx) -> { metrics: [{ id, value, n, details }] }
 *   ctx = { fixture, fixturePath, env, log, now }
 *
 * The render-list builders and the scorer are exported so
 * sms-readability.test.mjs can red-first this suite: prove a synthetic
 * grade-7 fixed template is correctly reported as exceeding the floor
 * before trusting that the real templates pass it.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const FIXTURE_PATH = join(REPO_ROOT, "config/benchmarks/fixtures/sms-readability.json");
const SMS_POLICY_PATH = join(REPO_ROOT, "src/lib/nudges/sms-policy-shared.ts");
const READABILITY_PATH = join(REPO_ROOT, "src/lib/sage/readability.ts");

/** One-syllable placeholder for every caller-supplied string slot. */
export const PLACEHOLDER = "X";

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

/**
 * Every template rendered with realistic, potentially long/complex
 * third-party values from the fixture — what a real student's phone
 * actually receives.
 */
export function buildRealisticRenders(fixture, smsPolicy) {
  const {
    buildWeeklyJobsSms,
    buildInterviewConfirmSms,
    buildInterviewDeclineAckSms,
    buildHeardBackSms,
    buildRetentionSms,
    buildNotificationSms,
  } = smsPolicy;

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

  return renders;
}

/**
 * Every template rendered with every caller-supplied slot neutralized to
 * PLACEHOLDER (a numeric slot gets its minimal representative value, 1,
 * since "X" is not a number) — isolating the fixed English sentences this
 * program authored and controls. One entry per DISTINCT fixed-text branch
 * (buildWeeklyJobsSms's singular/plural noun choice;
 * buildInterviewConfirmSms's place-present/place-absent tail), so a
 * regression in either branch's copy is caught.
 */
export function buildFixedTextRenders(smsPolicy) {
  const {
    buildWeeklyJobsSms,
    buildInterviewConfirmSms,
    buildInterviewDeclineAckSms,
    buildHeardBackSms,
    buildRetentionSms,
    buildNotificationSms,
  } = smsPolicy;

  return [
    { template: "buildWeeklyJobsSms", variant: "singular", fn: () => buildWeeklyJobsSms(1) },
    { template: "buildWeeklyJobsSms", variant: "plural", fn: () => buildWeeklyJobsSms(2) },
    {
      template: "buildInterviewConfirmSms",
      variant: "place given",
      fn: () =>
        buildInterviewConfirmSms({ employerName: PLACEHOLDER, when: PLACEHOLDER, place: PLACEHOLDER }),
    },
    {
      template: "buildInterviewConfirmSms",
      variant: "no place",
      fn: () => buildInterviewConfirmSms({ employerName: PLACEHOLDER, when: PLACEHOLDER }),
    },
    { template: "buildInterviewDeclineAckSms", variant: "only", fn: () => buildInterviewDeclineAckSms() },
    { template: "buildHeardBackSms", variant: "only", fn: () => buildHeardBackSms(PLACEHOLDER) },
    { template: "buildRetentionSms", variant: "only", fn: () => buildRetentionSms(PLACEHOLDER) },
    {
      template: "buildNotificationSms",
      variant: "fits",
      fn: () => buildNotificationSms(PLACEHOLDER, PLACEHOLDER),
    },
  ];
}

/**
 * Render + score a list of `{ template, args?, variant?, fn }` entries.
 * `fn` may throw `SmsBodyTooLongError`, counted as an over-limit violation
 * rather than a scorer crash.
 */
export function scoreRenderList(renders, ctx) {
  const { fleschKincaidGrade, gsm7Set, SmsBodyTooLongError } = ctx;
  const scored = [];
  const overLimit = [];

  for (const render of renders) {
    let body;
    try {
      body = render.fn();
    } catch (err) {
      if (SmsBodyTooLongError && err instanceof SmsBodyTooLongError) {
        overLimit.push({
          template: render.template,
          args: render.args ?? {},
          variant: render.variant,
          reason: "too_long",
          error: err.message,
        });
        continue;
      }
      throw err;
    }

    const grade = fleschKincaidGrade(body);
    const gsm7Safe = isGsm7Safe(body, gsm7Set);
    if (body.length > 160 || !gsm7Safe) {
      overLimit.push({
        template: render.template,
        args: render.args ?? {},
        variant: render.variant,
        reason: body.length > 160 ? "length" : "non_gsm7_char",
        body,
        length: body.length,
      });
    }
    scored.push({
      template: render.template,
      args: render.args ?? {},
      variant: render.variant,
      body,
      grade,
      length: body.length,
    });
  }

  const maxEntry = scored.reduce(
    (worst, entry) => (worst === null || entry.grade > worst.grade ? entry : worst),
    null,
  );
  const worst = scored
    .slice()
    .sort((a, b) => b.grade - a.grade)
    .slice(0, 10)
    .map((entry) => ({
      template: entry.template,
      variant: entry.variant,
      grade: entry.grade,
      length: entry.length,
      body: entry.body,
    }));

  return { scored, overLimit, maxEntry, worst };
}

export async function run(ctx) {
  const fixture = ctx?.fixture ?? JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const [smsPolicy, readability] = await Promise.all([
    import(SMS_POLICY_PATH),
    import(READABILITY_PATH),
  ]);
  const { fleschKincaidGrade } = readability;
  const { GSM7_BASIC, SmsBodyTooLongError } = smsPolicy;
  const gsm7Set = new Set(GSM7_BASIC.split(""));
  const scoreCtx = { fleschKincaidGrade, gsm7Set, SmsBodyTooLongError };

  const fixedRenders = buildFixedTextRenders(smsPolicy);
  const realisticRenders = buildRealisticRenders(fixture, smsPolicy);

  const fixedResult = scoreRenderList(fixedRenders, scoreCtx);
  const realisticResult = scoreRenderList(realisticRenders, scoreCtx);

  return {
    metrics: [
      {
        id: "fixed_text_max_grade",
        value: fixedResult.maxEntry ? fixedResult.maxEntry.grade : 0,
        n: fixedResult.scored.length,
        details: { worst: fixedResult.worst, all: fixedResult.scored },
      },
      {
        id: "rendered_max_grade",
        value: realisticResult.maxEntry ? realisticResult.maxEntry.grade : 0,
        n: realisticResult.scored.length,
        details: { worst: realisticResult.worst, maxEntry: realisticResult.maxEntry },
      },
      {
        id: "over_160_gsm7",
        value: realisticResult.overLimit.length,
        n: realisticRenders.length,
        details: { violations: realisticResult.overLimit },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
