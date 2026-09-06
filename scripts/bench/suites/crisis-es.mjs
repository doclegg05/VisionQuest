/**
 * crisis-es — Spanish crisis-detector precision and recall.
 *
 * TIER IS `watch`, FOR TWO INDEPENDENT REASONS.
 * ---------------------------------------------------------------------------
 * 1. NO ROW IN THIS CORPUS HAS HAD A NATIVE-SPEAKER REVIEW. That review is a
 *    standing owner step (.claude/MEMORY.md: "native-speaker review of Spanish
 *    informal/euphemistic crisis register — the ES equivalent of unalive/kms
 *    is unassessed"), and the benchmark plan adopts it as decision 3: the
 *    Spanish corpus ships at watch tier until a native speaker signs it off.
 *    Every row therefore carries `reviewed: false`, including the rows copied
 *    from the unit fixtures — those were code-reviewed, which is not the same
 *    thing as a native speaker reading them.
 * 2. The same three means families missing in English are missing in Spanish
 *    (firearms, hanging, jumping), so recall here is below the design floor
 *    for the same structural reason as its English sibling.
 *
 * Gating on a corpus nobody qualified has read would make the number look
 * authoritative before it is. Reporting it makes the gap visible while it
 * waits for the person who can settle it.
 *
 * MEASURED at the commit that introduced this suite:
 *   recall_must_detect       0.6667 over n=159   (floor 0.98)
 *   fp_rate_hard_negatives   0.0049 over n=206   (floor 0.02)
 *   fp_rate_neutral          0.0000 over n=107   (floor 0.00)
 *
 * Per-family recall: harm_others 15/15, abuse 20/21, means_pills 23/26,
 * explicit_intent 25/30, selfharm_cutting 8/12, passive_ideation 13/23, and
 * means_firearm 0/11, means_hanging 0/10, means_jumping 0/9.
 *
 * TWO FINDINGS BEYOND THE MEANS GAP, recorded not fixed:
 *
 *   1. Spanish passive ideation is the weakest covered family in either
 *      language, 13/23. "todos estarian mejor sin mi" — the direct twin of
 *      the English "everyone would be better off without me", which IS pinned
 *      and detected — passes silently, as do "ojala no despertara manana",
 *      "quisiera desaparecer y no volver" and "no le veo sentido a nada".
 *      That is a language-parity gap of exactly the shape the 2026-08-21
 *      review named an invariant.
 *   2. The kms/kilometres cross-language leak is only half closed.
 *      "caminé 5 kms hoy" is guarded (a digit precedes), but
 *      "la oficina esta a unos kms de aqui" still fires — and fires as
 *      lang "en", so a Spanish speaker asking about a commute would be served
 *      the ENGLISH 988 block. The English guard spells "away"/"from" after
 *      "kms"; the Spanish "de" is not in it.
 *
 * WHEN THE NATIVE REVIEW HAPPENS: flip each reviewed flag as the reviewer
 * confirms the row, correct any row they reject (correcting the CORPUS, never
 * the floor), and record who reviewed it and when in the fixture header.
 */
import { pathToFileURL } from "node:url";
import { scoreCorpus, selfTest } from "./crisis-corpus.mjs";

export async function run(ctx) {
  const result = await scoreCorpus(ctx.fixture);
  // Surface the review state on the headline metric: a reader looking at this
  // number needs to know how much of the corpus is still unreviewed.
  const reviewed = ctx.fixture.rows.filter((row) => row.reviewed === true).length;
  const recall = result.metrics.find((m) => m.id === "recall_must_detect");
  recall.details.nativeSpeakerReviewedRows = reviewed;
  recall.details.unreviewedRows = ctx.fixture.rows.length - reviewed;
  return result;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  if (process.argv.includes("--self-test")) {
    await selfTest({ suite: "crisis-es", otherFixture: "config/benchmarks/fixtures/crisis-en.json" });
  } else {
    console.error("usage: node --import tsx scripts/bench/suites/crisis-es.mjs --self-test");
    process.exitCode = 2;
  }
}
