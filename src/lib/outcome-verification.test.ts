import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  OUTCOME_VERIFICATION,
  classifyOutcomeVerification,
  splitOutcomeVerificationCounts,
} from "./outcome-verification";

describe("classifyOutcomeVerification", () => {
  it("maps the two known statuses to their buckets", () => {
    assert.equal(classifyOutcomeVerification(OUTCOME_VERIFICATION.VERIFIED), "verified");
    assert.equal(classifyOutcomeVerification(OUTCOME_VERIFICATION.SELF_REPORTED), "self_reported");
  });

  it("treats null, undefined, and unknown values as legacy", () => {
    assert.equal(classifyOutcomeVerification(null), "legacy");
    assert.equal(classifyOutcomeVerification(undefined), "legacy");
    assert.equal(classifyOutcomeVerification("something_else"), "legacy");
  });
});

describe("splitOutcomeVerificationCounts (grant report split)", () => {
  it("buckets verified and self-reported counts and drops legacy rows from both", () => {
    const split = splitOutcomeVerificationCounts([
      { verificationStatus: "verified", count: 3 },
      { verificationStatus: "self_reported", count: 5 },
      // Legacy pre-feature rows: count in report totals, in neither bucket.
      { verificationStatus: null, count: 2 },
    ]);
    assert.deepEqual(split, { verifiedCount: 3, selfReportedCount: 5 });
  });

  it("returns zeros for an empty period", () => {
    assert.deepEqual(splitOutcomeVerificationCounts([]), {
      verifiedCount: 0,
      selfReportedCount: 0,
    });
  });

  it("sums multiple groups of the same bucket without mutating inputs", () => {
    const rows = [
      { verificationStatus: "verified", count: 1 },
      { verificationStatus: "verified", count: 4 },
    ];
    const split = splitOutcomeVerificationCounts(rows);
    assert.deepEqual(split, { verifiedCount: 5, selfReportedCount: 0 });
    assert.deepEqual(rows, [
      { verificationStatus: "verified", count: 1 },
      { verificationStatus: "verified", count: 4 },
    ]);
  });
});
