import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAbstention } from "./rag-abstention.mjs";

function inCorpusCase(id, hasContext) {
  return { id, expectedStorageKeys: ["forms/x.pdf"], hasContext, noAnswerOk: null };
}
function offTopicCase(id, noAnswerOk) {
  return { id, expectedStorageKeys: [], hasContext: !noAnswerOk, noAnswerOk };
}

test("scoreAbstention: an in-corpus case with no context is a false abstain", () => {
  const scored = scoreAbstention([inCorpusCase("a", true), inCorpusCase("b", false)]);
  assert.equal(scored.inCorpusTotal, 2);
  assert.equal(scored.falseAbstainCount, 1);
  assert.equal(scored.falseAbstainRate, 0.5);
  assert.deepEqual(scored.falseAbstainIds, ["b"]);
});

test("scoreAbstention: off-topic cases with noAnswerOk=true count as correct abstentions", () => {
  const scored = scoreAbstention([offTopicCase("c", true), offTopicCase("d", false)]);
  assert.equal(scored.offTopicTotal, 2);
  assert.equal(scored.offtopicAbstainRate, 0.5);
});

test("scoreAbstention: a case is either in-corpus or off-topic, never counted in both buckets", () => {
  const scored = scoreAbstention([inCorpusCase("a", true), offTopicCase("b", true)]);
  assert.equal(scored.inCorpusTotal, 1);
  assert.equal(scored.offTopicTotal, 1);
});

test("scoreAbstention: empty results report 0 rates, not NaN", () => {
  const scored = scoreAbstention([]);
  assert.equal(scored.falseAbstainRate, 0);
  assert.equal(scored.offtopicAbstainRate, 0);
});
