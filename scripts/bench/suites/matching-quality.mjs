#!/usr/bin/env node
// =============================================================================
// matching-quality — does the ranker put the obvious jobs on top?
//
// For each of the 50 synthetic students: take the leads they can actually see,
// rank them with the REAL ranker, and compare the top of that ranking against
// the instructor-style labels in config/benchmarks/fixtures/matching-labels.json.
//
//   precision_at_3 — of the top three, how many are labelled `fit`? (gate, 0.80)
//   ndcg_at_5      — the same question with graded relevance and position
//                    discount, so a `stretch` at rank 2 scores better than a
//                    `stretch` at rank 5. (info)
//
// THE REAL RANKER, NOT A COPY. `rankLeadFits` is imported from
// src/lib/connect/matching-shared.ts and is the same function
// `rankLeadsForStudent` calls after its query. A benchmark that re-implemented
// scoring or sorting would keep passing after the product's ranking changed,
// which is the specific way this kind of metric dies.
//
// THE LABELS ARE NOT THE SCORE. See the header of
// scripts/bench/generate-matching-labels.mjs: the labels come from a written
// judgement rule about clusters, shifts, pay floor and credentials, and
// deliberately ignore the axes the ranker weights most (location, RIASEC,
// résumé skills, source trust, hired-a-grad-before). The ranker can therefore
// disagree, which is the only reason the number means anything.
//
//   node scripts/bench/suites/matching-quality.mjs --self-test
// =============================================================================

import { loadCohort, toMatchLead, toMatchStudent, visibleLeadsFor } from "../lib/cohort.mjs";
import { selfTest } from "../lib/self-test.mjs";

/** Graded relevance for NDCG. A block scores nothing — it should not be there at all. */
const GAIN = { fit: 2, stretch: 1, block: 0 };

function dcg(gains) {
  return gains.reduce((total, gain, index) => total + gain / Math.log2(index + 2), 0);
}

export async function run(ctx) {
  // Imported through tsx (the runner starts Node with `--import tsx`), so the
  // TypeScript source is loaded directly rather than a build artifact that
  // could lag behind it.
  const { rankLeadFits } = await import("../../../src/lib/connect/matching-shared.ts");

  const cohort = loadCohort();
  const labels = new Map(
    ctx.fixture.pairs.map((pair) => [`${pair.studentId}/${pair.leadId}`, pair]),
  );

  let precisionSum = 0;
  let ndcgSum = 0;
  let scored = 0;
  const skipped = [];
  const worst = [];

  for (const student of cohort.students) {
    const visible = visibleLeadsFor(cohort, student);
    const ranked = rankLeadFits(
      toMatchStudent(cohort, student),
      visible.map(toMatchLead),
    );

    const labelOf = (leadId) => labels.get(`${student.id}/${leadId}`)?.label ?? "stretch";
    const fitsAvailable = visible.filter((lead) => labelOf(lead.id) === "fit").length;

    if (ranked.length < 3 || fitsAvailable === 0) {
      // Recorded rather than silently averaged over. A student with nothing to
      // rank contributes no information, and folding them in at 0 would report
      // a ranking failure that is really a fixture gap.
      skipped.push({ studentId: student.id, ranked: ranked.length, fitsAvailable });
      continue;
    }

    // Denominator capped by what is achievable: a student with only two `fit`
    // leads can never fill three slots, and scoring them out of 3 would measure
    // the fixture, not the ranker.
    const top3 = ranked.slice(0, 3).map((entry) => entry.lead.id);
    const hits = top3.filter((leadId) => labelOf(leadId) === "fit").length;
    const precision = hits / Math.min(3, fitsAvailable);
    precisionSum += precision;

    const top5Gains = ranked.slice(0, 5).map((entry) => GAIN[labelOf(entry.lead.id)] ?? 0);
    const idealGains = visible
      .map((lead) => GAIN[labelOf(lead.id)] ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 5);
    const ideal = dcg(idealGains);
    ndcgSum += ideal === 0 ? 0 : dcg(top5Gains) / ideal;

    scored += 1;
    if (precision < 1) {
      worst.push({
        studentId: student.id,
        precision: Number(precision.toFixed(3)),
        // The label reason for each miss, so a failing run says WHICH
        // judgement the ranker disagreed with rather than only that it did.
        misses: top3
          .filter((leadId) => labelOf(leadId) !== "fit")
          .map((leadId) => ({
            leadId,
            label: labelOf(leadId),
            why: labels.get(`${student.id}/${leadId}`)?.reason ?? "",
          })),
      });
    }
  }

  const round = (value) => Number(value.toFixed(4));

  return {
    metrics: [
      {
        id: "precision_at_3",
        value: scored === 0 ? 0 : round(precisionSum / scored),
        n: scored,
        details: {
          studentsSkipped: skipped.length,
          skipped: skipped.slice(0, 5),
          // Sorted worst-first and capped: a failing gate should show the ten
          // most informative disagreements, not two thousand rows.
          worstStudents: worst.sort((a, b) => a.precision - b.precision).slice(0, 10),
        },
      },
      {
        id: "ndcg_at_5",
        value: scored === 0 ? 0 : round(ndcgSum / scored),
        n: scored,
      },
    ],
  };
}

await selfTest(import.meta.url, run);
