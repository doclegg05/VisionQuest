import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveFormRankingMode, scoreFormSearchCases } from "./form-ranking.mjs";

test("scoreFormSearchCases: top1 hit when the expected id is first", () => {
  const scored = scoreFormSearchCases([
    { id: "a", ids: ["x", "y"], expectedFormIds: ["x"], forbiddenFormIds: [] },
  ]);
  assert.equal(scored.top1Rate, 1);
  assert.equal(scored.top3Rate, 1);
  assert.equal(scored.forbiddenHits, 0);
});

test("scoreFormSearchCases: top3 hit but not top1 when expected id is second", () => {
  const scored = scoreFormSearchCases([
    { id: "a", ids: ["y", "x"], expectedFormIds: ["x"], forbiddenFormIds: [] },
  ]);
  assert.equal(scored.top1Rate, 0);
  assert.equal(scored.top3Rate, 1);
});

test("scoreFormSearchCases: a forbidden id inside the top-3 is counted even when the case also passes", () => {
  const scored = scoreFormSearchCases([
    { id: "a", ids: ["x", "forbidden-1"], expectedFormIds: ["x"], forbiddenFormIds: ["forbidden-1"] },
  ]);
  assert.equal(scored.top1Rate, 1);
  assert.equal(scored.forbiddenHits, 1);
  assert.deepEqual(scored.results[0].forbiddenInTop3, ["forbidden-1"]);
});

test("scoreFormSearchCases: a forbidden id ranked past the top-3 window does not count", () => {
  const scored = scoreFormSearchCases([
    {
      id: "a",
      ids: ["x", "y", "z", "forbidden-1"],
      expectedFormIds: ["x"],
      forbiddenFormIds: ["forbidden-1"],
    },
  ]);
  assert.equal(scored.forbiddenHits, 0);
});

test("scoreFormSearchCases: no expected ids never counts as a top1/top3 hit", () => {
  const scored = scoreFormSearchCases([{ id: "a", ids: ["x"], expectedFormIds: [], forbiddenFormIds: [] }]);
  assert.equal(scored.top1Rate, 0);
  assert.equal(scored.top3Rate, 0);
});

test("scoreFormSearchCases: empty case list reports rates of 0, not NaN", () => {
  const scored = scoreFormSearchCases([]);
  assert.equal(scored.top1Rate, 0);
  assert.equal(scored.top3Rate, 0);
  assert.equal(scored.total, 0);
});

// --- search mode is part of the measurement, not an accident of the env ---
//
// `searchForms()` ranks hybrid (embeddings + keyword) when an embedding index
// is reachable and keyword-only when it is not, reporting which in
// `result.method`. The baselined `top1 0.917` was measured keyword-only, so if
// the CI database ever gained form embeddings the number would move for a
// reason that is not a regression — and a moved baseline nobody can explain is
// exactly what this suite exists to prevent. The declared mode is therefore an
// input, and any case that ran under a different one is counted and floored.

test("resolveFormRankingMode defaults to keyword — the mode the baseline was measured in", () => {
  assert.equal(resolveFormRankingMode({}), "keyword");
  assert.equal(resolveFormRankingMode({ FORM_RANKING_MODE: "" }), "keyword");
  assert.equal(resolveFormRankingMode({ FORM_RANKING_MODE: "  " }), "keyword");
});

test("resolveFormRankingMode accepts an explicit hybrid declaration", () => {
  assert.equal(resolveFormRankingMode({ FORM_RANKING_MODE: "hybrid" }), "hybrid");
  assert.equal(resolveFormRankingMode({ FORM_RANKING_MODE: "KEYWORD" }), "keyword");
});

test("resolveFormRankingMode throws on an unrecognised value rather than defaulting", () => {
  // Silently falling back to `keyword` on a typo would re-create the very
  // ambiguity this knob exists to remove.
  assert.throws(() => resolveFormRankingMode({ FORM_RANKING_MODE: "semantic" }), /FORM_RANKING_MODE/);
});

test("scoreFormSearchCases counts cases that ran in a mode other than the declared one", () => {
  const cases = [
    { id: "a", ids: ["x"], expectedFormIds: ["x"], forbiddenFormIds: [], method: "keyword" },
    { id: "b", ids: ["x"], expectedFormIds: ["x"], forbiddenFormIds: [], method: "hybrid" },
  ];
  const scored = scoreFormSearchCases(cases, { expectedMode: "keyword" });
  assert.equal(scored.offModeCases, 1);
  assert.deepEqual(
    scored.offModeDetails,
    [{ id: "b", method: "hybrid" }],
    "the offending case is named, so an operator can see what changed"
  );
});

test("scoreFormSearchCases reports 0 off-mode cases when every case matches", () => {
  const cases = [
    { id: "a", ids: ["x"], expectedFormIds: ["x"], forbiddenFormIds: [], method: "keyword" },
    { id: "b", ids: ["y"], expectedFormIds: ["y"], forbiddenFormIds: [], method: "keyword" },
  ];
  assert.equal(scoreFormSearchCases(cases, { expectedMode: "keyword" }).offModeCases, 0);
});

test("a case with no reported method counts as off-mode — unknown is not the same as matching", () => {
  const cases = [{ id: "a", ids: ["x"], expectedFormIds: ["x"], forbiddenFormIds: [] }];
  assert.equal(scoreFormSearchCases(cases, { expectedMode: "keyword" }).offModeCases, 1);
});

test("the suite config declares off_mode_cases with a floor of 0", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../../config/benchmarks/form-ranking.json", import.meta.url), "utf8")
  );
  const metric = config.metrics.find((m) => m.id === "off_mode_cases");
  assert.ok(metric, "off_mode_cases must be a declared metric, not just an internal tally");
  assert.equal(metric.floor, 0);
  assert.equal(metric.direction, "lower");
  assert.match(config.notes, /FORM_RANKING_MODE/);
});
