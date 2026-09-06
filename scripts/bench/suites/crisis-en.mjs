/**
 * crisis-en — English crisis-detector precision and recall.
 *
 * TIER IS `watch`, NOT `gate`, AND THAT IS A MEASURED FINDING, NOT A DEFAULT.
 * ---------------------------------------------------------------------------
 * The design (docs/superpowers/specs/2026-09-05-benchmark-suite-design.md §4.1)
 * proposes this suite as a gate at recall >= 0.98. The detector as shipped
 * cannot meet that, because three means families named in .claude/MEMORY.md as
 * "the largest remaining coverage gap" have NO patterns at all in either
 * language: firearms, hanging, and jumping. The corpus includes them anyway —
 * measuring honestly is the point of a benchmark — so the headline recall sits
 * below the floor and the suite reports instead of failing. Per-family recall
 * is in `details.recallByFamily` so the dashboard shows exactly which families
 * are at zero rather than one averaged number that hides them.
 *
 * The floors stay in config/benchmarks/crisis-en.json at their design values.
 * They are the target, and lowering them to make today's number pass is
 * exactly what the frozen-grader rule (PR #137) forbids. The tier flips to
 * `gate` in the PR that adds those pattern families and shows the floor being
 * met — not before, and never by relaxing the number.
 *
 * MEASURED at the commit that introduced this suite:
 *   recall_must_detect       0.7087 over n=206   (floor 0.98)
 *   fp_rate_hard_negatives   0.0064 over n=312   (floor 0.02)
 *   fp_rate_neutral          0.0000 over n=110   (floor 0.00)
 *
 * Per-family recall: harm_others 15/15, informal_evasion 24/24,
 * abuse 14/15, explicit_intent 33/36, means_pills 22/27, passive_ideation
 * 24/30, selfharm_cutting 12/16, and means_firearm 0/16, means_hanging 0/13,
 * means_jumping 0/12 — the three named families, at zero, as expected.
 *
 * THE CORPUS ALSO FOUND FOUR GAPS NOBODY HAD MEASURED, all outside those three
 * families. They are recorded here rather than fixed, because fixing the
 * detector is not this suite's job and a benchmark that quietly patches what
 * it measures is not a benchmark:
 *
 *   1. "hurting myself" is a MISS while "cutting myself" matches. The pattern
 *      is /(hurt|harm|cut)(ting|t)?\s+myself/ — "cut"+"ting" is spelled by the
 *      alternation, "hurt"+"ing" is not. So "i keep hurting myself when i get
 *      like this" raises nothing while "i've been cutting myself again" does.
 *   2. "im overdosing" (no apostrophe) is a MISS while "i'm overdosing"
 *      matches: the first-person frame /i(?:'m|'ve|'d)?/ spells the
 *      apostrophe forms but not the bare "im" this population types.
 *   3. Passive ideation phrased around absence rather than death is thin —
 *      "i wish i wasnt here anymore", "id rather be dead than keep going like
 *      this", "nothing would change if i was gone", "i wish i had never been
 *      born" all pass silently.
 *   4. Two knife-in-the-kitchen rows FIRE ("i cut myself chopping onions last
 *      night", "i cut myself shaving this morning"). Recall-first makes that
 *      the cheap direction to be wrong in, but it is the whole hard-negative
 *      false-positive rate on this corpus and worth a guard when someone
 *      touches that pattern.
 *
 * The corpus and the pinned cross-check are documented in
 * config/benchmarks/fixtures/README.md.
 */
import { pathToFileURL } from "node:url";
import { scoreCorpus, selfTest } from "./crisis-corpus.mjs";

export async function run(ctx) {
  return scoreCorpus(ctx.fixture);
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  if (process.argv.includes("--self-test")) {
    await selfTest({ suite: "crisis-en", otherFixture: "config/benchmarks/fixtures/crisis-es.json" });
  } else {
    console.error("usage: node --import tsx scripts/bench/suites/crisis-en.mjs --self-test");
    process.exitCode = 2;
  }
}
