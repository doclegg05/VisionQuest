// =============================================================================
// Red-first proof for the nudge-attribution comparator.
//
// Three of the four counters were also shown rising against real throwaway
// breaks in the nudge code (recorded in the suite config's notes). The fourth,
// direct_followup_writes, cannot be — nothing on the reply path writes
// SpokesEmploymentFollowUp today, which is exactly the property it guards. So
// the comparator is driven here with observations that ARE wrong, one counter
// at a time, and the routing from a mismatched key to its counter is pinned.
// =============================================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareCase, tallyFindings } from "./nudge-attribution.mjs";

const SPEC = {
  id: "example",
  inbound: [{ phone: 0, body: "Y" }],
  expect: {
    outcomes: [{ outcome: "handled", kind: "retention" }],
    claimedTemplateKeys: ["retention_30"],
    connectionStatuses: { con0: "retained_30" },
    followUpWrites: 0,
    prefsRevokedOnRepliedNumber: 2,
    questionsOpenedByStudent: { 0: 0 },
  },
};

const CORRECT = {
  case: "example",
  outcomes: [{ outcome: "handled", kind: "retention" }],
  claimedTemplateKeys: ["retention_30"],
  connectionStatuses: { con0: "retained_30" },
  followUpWrites: 0,
  prefsRevokedOnRepliedNumber: 2,
  questionsOpenedByStudent: { 0: 0 },
};

describe("nudge-attribution comparator", () => {
  it("finds nothing when the observation matches", () => {
    assert.deepEqual(compareCase(SPEC, CORRECT), []);
  });

  it("routes a wrong claimed question to misattributed_replies", () => {
    const findings = compareCase(SPEC, { ...CORRECT, claimedTemplateKeys: ["weekly_jobs"] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].metric, "misattributed_replies");
    assert.equal(tallyFindings(findings, [CORRECT]).misattributed_replies, 1);
  });

  it("routes a stacked question to second_question_opened", () => {
    const findings = compareCase(SPEC, { ...CORRECT, questionsOpenedByStudent: { 0: 1 } });
    assert.equal(findings.length, 1);
    assert.equal(tallyFindings(findings, [CORRECT]).second_question_opened, 1);
  });

  it("routes a partial STOP to stop_revocations_incomplete", () => {
    const findings = compareCase(SPEC, { ...CORRECT, prefsRevokedOnRepliedNumber: 1 });
    assert.equal(findings.length, 1);
    assert.equal(tallyFindings(findings, [CORRECT]).stop_revocations_incomplete, 1);
  });

  it("counts a grant-record write even on a case that never declared the key", () => {
    const undeclared = { id: "quiet", expect: { outcomes: [] } };
    const wrote = { case: "quiet", outcomes: [], followUpWrites: 1 };
    // The case asserts nothing about follow-ups, so the comparator is silent…
    assert.deepEqual(compareCase(undeclared, wrote), []);
    // …and the counter still sees it, which is the whole point.
    assert.equal(tallyFindings([], [wrote]).direct_followup_writes, 1);
  });

  it("does not double-count a declared follow-up write", () => {
    const findings = compareCase(SPEC, { ...CORRECT, followUpWrites: 1 });
    assert.equal(findings.length, 1);
    const counts = tallyFindings(findings, [{ ...CORRECT, followUpWrites: 1 }]);
    assert.equal(counts.direct_followup_writes, 1);
    assert.equal(counts.misattributed_replies, 0);
  });

  it("checks only the keys a case declared", () => {
    const narrow = { id: "narrow", expect: { outcomes: [{ outcome: "ignored" }] } };
    assert.deepEqual(
      compareCase(narrow, { case: "narrow", outcomes: [{ outcome: "ignored" }], prefsEnabled: 99 }),
      [],
    );
  });
});
