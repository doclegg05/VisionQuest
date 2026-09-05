/**
 * Benchmark: form-ranking.
 *
 * Promotes scripts/sage-form-harness.mjs to a gated numeric benchmark.
 * Runs IN-PROCESS (per the build plan) — imports the REAL `searchForms()`
 * from src/lib/spokes/form-search.ts, the exact function sage-form-harness.mjs
 * calls, so there is no duplicated ranking logic, only the scoring tally.
 *
 * Self-test:
 *   node --import tsx scripts/bench/suites/form-ranking.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";

/**
 * The search mode this suite measures. `searchForms()` ranks hybrid
 * (embeddings + keyword) when an embedding index is reachable and keyword-only
 * when it is not — a decision made by the environment, not by the code under
 * test. This benchmark's baseline was measured keyword-only, so if a database
 * with form embeddings ever appeared under it the number would move for a
 * reason that is not a regression, and a moved baseline nobody can explain is
 * the failure this whole suite exists to prevent.
 *
 * So the mode is an declared INPUT: `FORM_RANKING_MODE=keyword` (the default)
 * or `hybrid`. Cases that ran under a different mode are counted into the
 * floored `off_mode_cases` metric, which fails the gate — loudly, and naming
 * the offenders — rather than quietly reporting a different `top1`.
 *
 * Switching to hybrid is a legitimate change; it just has to be deliberate:
 * set the variable, re-measure, and re-baseline with a reason.
 */
export const FORM_RANKING_MODES = Object.freeze(["keyword", "hybrid"]);
export const DEFAULT_FORM_RANKING_MODE = "keyword";

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {"keyword"|"hybrid"}
 */
export function resolveFormRankingMode(env = process.env) {
  const raw = env?.FORM_RANKING_MODE;
  if (typeof raw !== "string" || raw.trim().length === 0) return DEFAULT_FORM_RANKING_MODE;
  const mode = raw.trim().toLowerCase();
  if (!FORM_RANKING_MODES.includes(mode)) {
    // Never fall back to the default on a typo: that would restore exactly the
    // ambiguity this knob removes.
    throw new Error(
      `FORM_RANKING_MODE must be one of ${FORM_RANKING_MODES.join(", ")} (got ${JSON.stringify(raw)})`
    );
  }
  return mode;
}

/**
 * Pure scoring over already-computed search results — the unit-testable core.
 *
 * @param {Array<{id: string, ids: string[], expectedFormIds?: string[], forbiddenFormIds?: string[], method?: string}>} cases
 * @param {{ expectedMode?: "keyword"|"hybrid" }} [options]
 */
export function scoreFormSearchCases(cases, options = {}) {
  const expectedMode = options.expectedMode ?? DEFAULT_FORM_RANKING_MODE;
  const results = [];
  const offModeDetails = [];
  let top1 = 0;
  let top3 = 0;
  let forbiddenHits = 0;

  for (const c of cases) {
    // A case with no reported method is off-mode too: "unknown" is not the
    // same as "matched", and treating it as a match would hide the very drift
    // this counts.
    if (c.method !== expectedMode) {
      offModeDetails.push({ id: c.id, method: c.method ?? null });
    }
    const ids = c.ids;
    const expected = c.expectedFormIds ?? [];
    const forbidden = c.forbiddenFormIds ?? [];
    const top3Ids = ids.slice(0, 3);
    const inTop1 = expected.length > 0 && ids[0] === expected[0];
    const inTop3 = expected.some((e) => top3Ids.includes(e));
    const forbiddenInTop3 = top3Ids.filter((id) => forbidden.includes(id));

    if (inTop1) top1++;
    if (inTop3) top3++;
    forbiddenHits += forbiddenInTop3.length;

    results.push({ id: c.id, ids, inTop1, inTop3, forbiddenInTop3 });
  }

  const total = cases.length;
  return {
    total,
    top1Rate: total ? top1 / total : 0,
    top3Rate: total ? top3 / total : 0,
    forbiddenHits,
    expectedMode,
    offModeCases: offModeDetails.length,
    offModeDetails,
    results,
  };
}

export async function run(ctx) {
  const { searchForms } = await import("../../../src/lib/spokes/form-search.ts");
  const fixture = ctx.fixture ?? { cases: [] };
  const cases = fixture.cases ?? [];
  const expectedMode = resolveFormRankingMode();

  const withResults = [];
  for (const c of cases) {
    const res = await searchForms({ query: c.query, role: c.role ?? "student", limit: 3 });
    withResults.push({ ...c, ids: res.candidates.map((cand) => cand.form.id), method: res.method });
  }

  const scored = scoreFormSearchCases(withResults, { expectedMode });
  ctx.log(`ranking mode: ${expectedMode} (${scored.offModeCases} of ${scored.total} cases off-mode)`);

  return {
    metrics: [
      {
        id: "off_mode_cases",
        value: scored.offModeCases,
        n: scored.total,
        details: { expectedMode, offMode: scored.offModeDetails },
      },
      {
        id: "top1",
        value: scored.top1Rate,
        n: scored.total,
        details: { failing: scored.results.filter((r) => !r.inTop1).map((r) => r.id) },
      },
      { id: "top3", value: scored.top3Rate, n: scored.total },
      {
        id: "forbidden_hits",
        value: scored.forbiddenHits,
        n: scored.total,
        details: { hits: scored.results.filter((r) => r.forbiddenInTop3.length > 0) },
      },
    ],
  };
}

await maybeRunSelfTest({ suite: "form-ranking", run, importMeta: import.meta });
