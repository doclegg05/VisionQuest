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

/** Pure scoring over already-computed search results — the unit-testable core. */
export function scoreFormSearchCases(cases) {
  const results = [];
  let top1 = 0;
  let top3 = 0;
  let forbiddenHits = 0;

  for (const c of cases) {
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
    results,
  };
}

export async function run(ctx) {
  const { searchForms } = await import("../../../src/lib/spokes/form-search.ts");
  const fixture = ctx.fixture ?? { cases: [] };
  const cases = fixture.cases ?? [];

  const withResults = [];
  for (const c of cases) {
    const res = await searchForms({ query: c.query, role: c.role ?? "student", limit: 3 });
    withResults.push({ ...c, ids: res.candidates.map((cand) => cand.form.id), method: res.method });
  }

  const scored = scoreFormSearchCases(withResults);

  return {
    metrics: [
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
