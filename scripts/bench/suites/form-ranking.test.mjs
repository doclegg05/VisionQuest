import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreFormSearchCases } from "./form-ranking.mjs";

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
