#!/usr/bin/env node
/**
 * Red-first proof for sms-readability's fixed_text_max_grade gate.
 *
 * "Red-first" here means: before trusting that the real SMS templates pass
 * the fixed_text_max_grade floor (6), prove the scoring mechanism actually
 * FAILS a template whose fixed text is grade 7 — a check that only ever
 * reports "pass" is not evidence of anything (2026-08-21 decision log: "a
 * fixture that passes for the wrong reason ... is worse than none").
 *
 * Not picked up by `npm test` (its glob is src/**) — run directly:
 *   npx tsx --test scripts/bench/suites/sms-readability.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFixedTextRenders,
  buildRealisticRenders,
  scoreRenderList,
  run,
} from "./sms-readability.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const FIXTURE_PATH = join(REPO_ROOT, "config/benchmarks/fixtures/sms-readability.json");

async function loadContext() {
  const smsPolicy = await import(join(REPO_ROOT, "src/lib/nudges/sms-policy-shared.ts"));
  const { fleschKincaidGrade } = await import(join(REPO_ROOT, "src/lib/sage/readability.ts"));
  const gsm7Set = new Set(smsPolicy.GSM7_BASIC.split(""));
  return {
    smsPolicy,
    scoreCtx: { fleschKincaidGrade, gsm7Set, SmsBodyTooLongError: smsPolicy.SmsBodyTooLongError },
  };
}

describe("sms-readability — red-first: the fixed_text_max_grade check must be able to fail", () => {
  it("flags a synthetic grade-7 fixed template as exceeding the floor=6 gate", async () => {
    const { scoreCtx } = await loadContext();

    // A hand-checked grade-7.4 sentence (verified against the real
    // fleschKincaidGrade before this test was written) standing in for a
    // regression that made our OWN copy too dense — the exact shape
    // fixed_text_max_grade exists to catch.
    const badRender = {
      template: "syntheticRegressionExample",
      variant: "grade-7",
      fn: () => "SPOKES: We have an important reminder about your upcoming visit. Reply STOP to stop.",
    };

    const { maxEntry } = scoreRenderList([badRender], scoreCtx);
    assert.ok(maxEntry, "expected one scored render");
    assert.ok(
      maxEntry.grade > 6,
      `expected the synthetic bad template to score above the floor (6), got ${maxEntry.grade}`,
    );
    // Pin the exact value so this red case cannot silently drift quiet if
    // fleschKincaidGrade's formula ever changes.
    assert.ok(
      maxEntry.grade >= 7 && maxEntry.grade < 8,
      `expected the pinned synthetic template near grade 7, got ${maxEntry.grade}`,
    );
  });

  it("a mix of one good and one bad fixed-text render reports the bad one as the max", async () => {
    const { scoreCtx } = await loadContext();
    const goodRender = {
      template: "syntheticGoodExample",
      variant: "grade-low",
      fn: () => "SPOKES: You got a new job match. Reply Y to see it. Reply STOP to stop.",
    };
    const badRender = {
      template: "syntheticRegressionExample",
      variant: "grade-7",
      fn: () => "SPOKES: We have an important reminder about your upcoming visit. Reply STOP to stop.",
    };

    const { maxEntry } = scoreRenderList([goodRender, badRender], scoreCtx);
    assert.equal(maxEntry.template, "syntheticRegressionExample");
    assert.ok(maxEntry.grade > 6);
  });
});

describe("sms-readability — fixed_text_max_grade: the real templates, now that the check is proven sensitive", () => {
  it("every real template's fixed-text branch scores at or under the floor (6)", async () => {
    const { smsPolicy, scoreCtx } = await loadContext();
    const renders = buildFixedTextRenders(smsPolicy);
    assert.ok(renders.length >= 8, "expected at least one render per template/branch");

    const { scored, maxEntry } = scoreRenderList(renders, scoreCtx);
    assert.equal(scored.length, renders.length, "every fixed-text render must score without throwing");

    const failures = scored.filter((entry) => entry.grade > 6);
    assert.deepEqual(
      failures,
      [],
      `fixed-text template(s) over the floor: ${JSON.stringify(failures, null, 2)}`,
    );
    assert.ok(maxEntry.grade <= 6, `max fixed-text grade ${maxEntry.grade} exceeds the floor (6)`);
  });
});

describe("sms-readability — rendered_max_grade stays tracked (not gated) and over_160_gsm7 stays clean", () => {
  it("run() reports all three metrics with fixed_text_max_grade computed independently of realistic values", async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const result = await run({ fixture, fixturePath: FIXTURE_PATH, env: {}, log: console, now: () => new Date() });
    const byId = Object.fromEntries(result.metrics.map((m) => [m.id, m]));

    assert.ok(byId.fixed_text_max_grade, "missing fixed_text_max_grade metric");
    assert.ok(byId.rendered_max_grade, "missing rendered_max_grade metric");
    assert.ok(byId.over_160_gsm7, "missing over_160_gsm7 metric");

    assert.ok(
      byId.fixed_text_max_grade.value <= 6,
      `fixed_text_max_grade ${byId.fixed_text_max_grade.value} must stay at or under 6`,
    );
    // rendered_max_grade has no floor — it is expected to run hot with real
    // job titles (that is the whole reason it is tracked, not gated) — this
    // just proves it is still measured, not silently dropped.
    assert.equal(typeof byId.rendered_max_grade.value, "number");
    assert.equal(byId.over_160_gsm7.value, 0, "realistic-value renders must still fit one GSM-7 segment");
  });

  it("buildRealisticRenders still produces the same combinatorial coverage as before", async () => {
    const { smsPolicy } = await loadContext();
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const renders = buildRealisticRenders(fixture, smsPolicy);
    // employerNames x whens x places (interview confirm) + counts (weekly)
    // + 1 (decline) + jobTitles (heard back) + employerNames (retention)
    // + notificationTitles x actionUrls.
    const expected =
      fixture.employerNames.length * fixture.whens.length * fixture.places.length +
      fixture.counts.length +
      1 +
      fixture.jobTitles.length +
      fixture.employerNames.length +
      fixture.notificationTitles.length * fixture.actionUrls.length;
    assert.equal(renders.length, expected);
  });
});
