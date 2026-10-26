import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MACC_APPLY_HINT,
  WORKFORCE_WV_COMPANY_LABEL,
  isWorkForceWvPosting,
} from "./wv-employer";

describe("isWorkForceWvPosting", () => {
  it("matches the NLx label on a careeronestop row", () => {
    assert.equal(
      isWorkForceWvPosting({ company: WORKFORCE_WV_COMPANY_LABEL, source: "careeronestop" }),
      true,
    );
  });

  it("tolerates whitespace and case drift in the company field", () => {
    assert.equal(
      isWorkForceWvPosting({ company: "  west virginia employer ", source: "careeronestop" }),
      true,
    );
  });

  it("ignores the label on other sources (a scraped board may reuse the words)", () => {
    assert.equal(
      isWorkForceWvPosting({ company: WORKFORCE_WV_COMPANY_LABEL, source: "jsearch" }),
      false,
    );
  });

  it("is false for a named employer, a missing company, or a missing source", () => {
    assert.equal(isWorkForceWvPosting({ company: "Acme Co", source: "careeronestop" }), false);
    assert.equal(isWorkForceWvPosting({ company: null, source: "careeronestop" }), false);
    assert.equal(isWorkForceWvPosting({ company: WORKFORCE_WV_COMPANY_LABEL, source: null }), false);
  });

  it("does not match a company that merely contains the label", () => {
    assert.equal(
      isWorkForceWvPosting({ company: "West Virginia Employer Services LLC", source: "careeronestop" }),
      false,
    );
  });
});

describe("MACC_APPLY_HINT", () => {
  it("names the MACC and the sign-in step in short sentences", () => {
    assert.ok(MACC_APPLY_HINT.includes("MACC"));
    assert.ok(/sign in/i.test(MACC_APPLY_HINT));
    for (const sentence of MACC_APPLY_HINT.split(/\.\s*/).filter(Boolean)) {
      assert.ok(sentence.split(/\s+/).length <= 18, `sentence too long: "${sentence}"`);
    }
  });
});
