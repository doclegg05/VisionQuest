import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { evaluateGroundingAssertions, runGroundingSamples } from "../../../scripts/lib/sage-grounding-eval.mjs";

import { passesRetrievalCase } from "../../../scripts/lib/sage-rag-utils.mjs";

const cases = JSON.parse(readFileSync("config/sage-answer-quality-eval.json", "utf8"));
const context = "[Program reference]\nLink: /api/documents/download?id=fixture-doc&mode=view\nAttendance is recorded daily.";

describe("grounded answer evaluation", () => {
  it("contains nine unsupported-answer cases and six supported controls", () => {
    assert.equal(cases.filter((row: { rubric: string }) => row.rubric !== "supported").length, 9);
    assert.equal(cases.filter((row: { rubric: string }) => row.rubric === "supported").length, 6);
    assert.equal(new Set(cases.map((row: { id: string }) => row.id)).size, 15);
  });
  for (const row of cases.filter((row: { redBaseline?: unknown }) => row.redBaseline)) {
    it(`${row.id}: rejects unsupported claims even with a referral, and accepts the honest response`, () => {
      const grade = (text: string) => evaluateGroundingAssertions({ text, context, assert: row.assert }).failures;
      assert.ok(grade(row.redBaseline.badReply).length > 0);
      assert.equal(grade(row.redBaseline.goodReply).length, 0);
      assert.ok(grade("").length > 0);
      assert.ok(grade("Ask your instructor.").length > 0, "a referral alone cannot replace acknowledging uncertainty");
    });
  }
  it("requires the expected citation in the answer, not just in the retrieved context", () => {
    const check = (text: string) => evaluateGroundingAssertions({ text, context, expectedDocumentIds: ["fixture-doc"], assert: { mustCiteSource: true } }).failures;
    assert.equal(check("See the [attendance source](/api/documents/download?id=fixture-doc&mode=view).").length, 0);
    assert.ok(check("The attendance source says so.").length > 0);
    assert.ok(check("[Source](/api/documents/download?id=invented&mode=view)").length > 0);
  });
  it("does not let a genuine citation excuse an invented claim", () => {
    const row = cases.find((row: { rubric: string }) => row.rubric === "refund");
    const result = evaluateGroundingAssertions({ text: row.redBaseline.badReply + " [Source](/api/documents/download?id=fixture-doc&mode=view)", context, assert: row.assert });
    assert.ok(result.failures.length > 0);
  });
  it("fails the case when any answer sample fails", async () => {
    let call = 0;
    const result = await runGroundingSamples(async () => ({ pass: ++call !== 2, text: `reply ${call}`, reason: call === 2 ? "invented date" : null }), 3);
    assert.equal(result.pass, false);
    assert.equal(result.samples.length, 3);
    assert.match(result.reason!, /sample 2: invented date/);
  });
});

it("source grading fails forbidden hits and correctly counts abstention", () => {
  const input = { audienceLeak: 0, expectNoContext: false, noAnswerOk: null, legacyPassed: true, relevancePassed: true };
  assert.equal(passesRetrievalCase(input), true);
  assert.equal(passesRetrievalCase({...input, audienceLeak: 1}), false);
  assert.equal(passesRetrievalCase({...input, expectNoContext: true, legacyPassed: false, noAnswerOk: true}), true);
  assert.equal(passesRetrievalCase({...input, expectNoContext: true, noAnswerOk: false}), false);
});

it("recognizes an honest expanded contraction but rejects the observed unsupported refund conclusion", () => {
  const row = cases.find((row: {rubric: string}) => row.rubric === "refund");
  assert.equal(evaluateGroundingAssertions({text: "I could not find the policy. Ask your instructor.", assert: row.assert}).failures.length, 0);
  assert.ok(evaluateGroundingAssertions({text: "I don't know your situation, but there is no money to refund. Ask your instructor.", assert: row.assert}).failures.length > 0);
});
