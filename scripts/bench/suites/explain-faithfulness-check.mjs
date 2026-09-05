#!/usr/bin/env node
// =============================================================================
// explain-faithfulness-check — is the guard itself any good?
//
// `explain_job` refuses its own draft when the draft states a fact the posting
// does not support. That guard is the only thing between a model's mistake and
// a student acting on it, and until now nobody had measured whether it works.
//
//   checker_recall          wrong explanations caught / wrong explanations. 1.0
//   checker_false_positives faithful explanations wrongly refused.            0
//   kind_attributed         caught cases where the checker named the RIGHT
//                           fact — informational, but it decides whether the
//                           student is told something useful.
//
// Both floors are absolute and neither has an acceptable non-zero rate. A
// missed fabrication reaches a student as fact. A false refusal costs a student
// their explanation and sends them to their instructor for an answer that was
// sitting there correct — and, worse, teaches whoever tunes this next that the
// guard is noisy and should be loosened.
//
// The corpus is generated (scripts/bench/generate-explain-fixtures.mjs) so the
// ground truth is the MUTATION rather than a later reading of the text: every
// wrong case is a faithful explanation with exactly one clause changed.
//
//   node scripts/bench/suites/explain-faithfulness-check.mjs --self-test
// =============================================================================

import { isSelfTest, selfTest } from "../lib/self-test.mjs";

const SUITE = "explain-faithfulness-check";

export async function run(ctx) {
  const { checkExplanationFaithfulness } = await import(
    "../../../src/lib/sage/agent/explain-faithfulness.ts"
  );

  const postings = new Map(ctx.fixture.postings.map((posting) => [posting.id, posting]));

  let wrongTotal = 0;
  let wrongCaught = 0;
  let kindCorrect = 0;
  const missed = [];
  const falsePositives = [];

  for (const entry of ctx.fixture.cases) {
    const posting = postings.get(entry.postingId);
    const findings = checkExplanationFaithfulness(entry.explanation, posting);

    if (entry.faithful) {
      if (findings.length > 0) {
        falsePositives.push({
          id: entry.id,
          why: entry.why,
          findings: findings.map((finding) => `${finding.kind}: ${finding.detail}`),
        });
      }
      continue;
    }

    wrongTotal += 1;
    if (findings.length === 0) {
      missed.push({ id: entry.id, mutation: entry.mutation, why: entry.why });
      continue;
    }
    wrongCaught += 1;
    if (findings.some((finding) => finding.kind === entry.mutation.kind)) kindCorrect += 1;
  }

  return {
    metrics: [
      {
        id: "checker_recall",
        value: wrongTotal === 0 ? 0 : Number((wrongCaught / wrongTotal).toFixed(4)),
        n: wrongTotal,
        details: { missed, wrongByKind: ctx.fixture.wrongByKind },
      },
      {
        id: "checker_false_positives",
        value: falsePositives.length,
        n: ctx.fixture.counts.faithful,
        details: { falsePositives },
      },
      {
        id: "kind_attributed",
        value: wrongCaught === 0 ? 0 : Number((kindCorrect / wrongCaught).toFixed(4)),
        n: wrongCaught,
      },
    ],
  };
}

if (isSelfTest(import.meta.url)) await selfTest(SUITE, run);
