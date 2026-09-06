#!/usr/bin/env node
// =============================================================================
// orientation-readiness — do the seven surfaces that show a readiness number
// show the SAME number for the same student?
//
//   consumer_disagreements       (student, surface) pairs whose score differs
//                                from the student's own dashboard.
//   denominator_is_all_items     1 when every production query supplying the
//                                orientation denominator counts ALL items.
//   score_decreases_on_completion  times a score went DOWN when a student
//                                completed an orientation item.
//
// In process, no database: the mappings are Prisma-free
// (src/lib/progression/readiness-consumers.ts) and the students come from the
// committed synthetic cohort, so this runs anywhere and reports the same
// numbers everywhere.
//
// WHY THE FACTS ARE DRAWN RATHER THAN READ. The shared cohort is Connect-shaped
// — it carries work profiles, leads and connections, not orientation progress
// or progression state. Drawing the readiness facts from a fixed seed, for the
// cohort's own 50 students, keeps this suite's population the same as every
// other cohort suite's while giving it the state those suites do not model.
//
// The drift dimension is the point. The three mappings differ most when a
// student's stored `Progression.state` has fallen behind their live rows, which
// is exactly the condition `buildReadinessSnapshot` reconciles and the other two
// mappings do not. A fixture where every state was perfectly in sync would
// report a much smaller disagreement than the product actually has.
//
//   node scripts/bench/suites/orientation-readiness.mjs --self-test
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";

import { loadCohort } from "../lib/cohort.mjs";
import { createRng } from "../lib/prng.mjs";
import { selfTest } from "../lib/self-test.mjs";
import { narrowedDenominators } from "./lib/orientation-denominator.mjs";

/** How much of the live world the stored progression state knows about. */
const DRIFT_KINDS = ["inSync", "partial", "stale"];

function pickDrift(rng, drift) {
  const draw = rng();
  if (draw < drift.inSyncShare) return DRIFT_KINDS[0];
  if (draw < drift.inSyncShare + drift.partialShare) return DRIFT_KINDS[1];
  return DRIFT_KINDS[2];
}

/**
 * One student's readiness world.
 *
 * `progressionState` is built to match `drift`: in sync, the state carries the
 * same certifications, portfolio items, résumé and shared page the live counts
 * report; stale, it carries none of them, which is what a student looks like
 * when those rows were written without a matching progression event.
 */
function buildFacts(rng, fixture, orientationCompleted) {
  const ranges = fixture.ranges;
  const drift = pickDrift(rng, fixture.drift);

  const certificationsEarned = rng.int(...ranges.certificationsEarned);
  const portfolioItemCount = rng.int(...ranges.portfolioItemCount);
  const hasResume = rng.chance(0.6);
  const portfolioShared = rng.chance(0.35);
  const longestStreak = rng.int(...ranges.longestStreak);
  const completedGoalLevels = rng.sample(ranges.goalLevels, rng.int(0, 3));
  const bhagCompleted = completedGoalLevels.includes("bhag");

  const known = drift === "inSync" ? 1 : drift === "partial" ? 0.5 : 0;
  const state = {
    orientationComplete: false,
    completedGoalLevels: drift === "stale" ? [] : completedGoalLevels,
    bhagCompleted,
    certificationsEarned: Math.floor(certificationsEarned * known),
    portfolioItemCount: Math.floor(portfolioItemCount * known),
    resumeCreated: drift === "inSync" ? hasResume : false,
    portfolioShared: drift === "inSync" ? portfolioShared : false,
    longestStreak,
  };

  return {
    drift,
    facts: {
      progressionState: JSON.stringify(state),
      orientationCompletedCount: orientationCompleted,
      orientationTotalCount: fixture.orientationItemCount,
      bhagCompleted,
      certificationsEarned,
      certificationRequirementsDone: rng.int(...ranges.certificationRequirementsDone),
      requiredCertificationTemplateCount: ranges.requiredCertificationTemplateCount,
      portfolioItemCount,
      hasResume,
      portfolioShared,
      completedGoalLevels,
      longestStreak,
    },
  };
}

export async function run(ctx) {
  const { READINESS_CONSUMERS, readinessForConsumer } = await import(
    "../../../src/lib/progression/readiness-consumers.ts"
  );

  const fixture = ctx.fixture;
  const cohort = loadCohort();
  const students = cohort.students;
  const reference = fixture.referenceConsumer;
  if (!READINESS_CONSUMERS.some((consumer) => consumer.id === reference)) {
    throw new Error(
      `the fixture's referenceConsumer "${reference}" is not a registered readiness consumer`,
    );
  }

  // --- 1. Do the surfaces agree? ---------------------------------------
  //
  // One draw per student, then every consumer scored from the SAME facts.
  // Anything that differs from the reference is a student who is told one
  // number and described to somebody else with another.
  const rng = createRng(fixture.seed);
  let disagreements = 0;
  const bySurface = {};
  const worstExamples = [];

  // One draw per cohort student. The student row itself is not read — what the
  // cohort supplies here is the population SIZE, so this suite's n matches the
  // matching, Connect and nudge suites' and the numbers can be read together.
  for (let index = 0; index < students.length; index += 1) {
    const orientationCompleted = rng.int(...fixture.ranges.orientationCompleted);
    const { drift, facts } = buildFacts(rng, fixture, orientationCompleted);

    const scores = {};
    for (const consumer of READINESS_CONSUMERS) {
      scores[consumer.id] = readinessForConsumer(consumer.id, facts).score;
    }

    const referenceScore = scores[reference];
    let worstGap = 0;
    for (const consumer of READINESS_CONSUMERS) {
      if (consumer.id === reference) continue;
      const gap = Math.abs(scores[consumer.id] - referenceScore);
      if (gap === 0) continue;
      disagreements += 1;
      bySurface[consumer.id] = (bySurface[consumer.id] ?? 0) + 1;
      worstGap = Math.max(worstGap, gap);
    }

    if (worstGap > 0) {
      // No student identifiers, no free text: the result file is committed.
      // `drift` plus the orientation fraction is enough to reproduce the row
      // from the seed, and is the only part a reader needs.
      worstExamples.push({ drift, orientationCompleted, worstGap, scores });
    }
  }

  worstExamples.sort((a, b) => b.worstGap - a.worstGap);

  // --- 2. Is the denominator still ALL items? --------------------------
  const files = fixture.denominatorCallSites.map((relativePath) => ({
    path: relativePath,
    source: readFileSync(path.join(ctx.repoRoot, relativePath), "utf8"),
  }));
  const offenders = narrowedDenominators(files);

  // --- 3. Does completing an item ever LOWER a score? ------------------
  //
  // A scripted order — 0, 1, 2 … up to the item count — rather than a random
  // one, so a failure names a step somebody can walk to by hand.
  const walkRng = createRng(`${fixture.seed}:monotonicity`);
  let decreases = 0;
  const decreaseExamples = [];

  // One walk per cohort student, so the monotonicity check covers the same
  // population size as the agreement check. The student row itself is not
  // read — the facts come from the seeded draw.
  for (let walk = 0; walk < students.length; walk += 1) {
    const { facts } = buildFacts(walkRng, fixture, 0);
    const previous = {};

    for (let completed = 0; completed <= fixture.monotonicity.steps; completed += 1) {
      const stepFacts = { ...facts, orientationCompletedCount: completed };
      for (const consumer of READINESS_CONSUMERS) {
        const score = readinessForConsumer(consumer.id, stepFacts).score;
        const before = previous[consumer.id];
        if (before !== undefined && score < before) {
          decreases += 1;
          if (decreaseExamples.length < 20) {
            decreaseExamples.push({
              surface: consumer.id,
              completed,
              from: before,
              to: score,
            });
          }
        }
        previous[consumer.id] = score;
      }
    }
  }

  return {
    metrics: [
      {
        id: "consumer_disagreements",
        value: disagreements,
        n: students.length * (READINESS_CONSUMERS.length - 1),
        details: {
          reference,
          bySurface,
          mappings: Object.fromEntries(
            READINESS_CONSUMERS.map((consumer) => [consumer.id, consumer.mapping]),
          ),
          worstExamples: worstExamples.slice(0, 5),
        },
      },
      {
        id: "denominator_is_all_items",
        value: offenders.length === 0 ? 1 : 0,
        n: files.length,
        details: { checked: fixture.denominatorCallSites, offenders },
      },
      {
        id: "score_decreases_on_completion",
        value: decreases,
        n: students.length * fixture.monotonicity.steps * READINESS_CONSUMERS.length,
        details: { examples: decreaseExamples },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
