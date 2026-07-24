import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateCareerPlanExtraction } from "./plan-extractor";

describe("validateCareerPlanExtraction", () => {
  it("returns empty result for null input", () => {
    const result = validateCareerPlanExtraction(null);
    assert.equal(result.terminal_outcome, null);
    assert.equal(result.stage_complete, false);
  });

  it("requires terminal outcome for stage_complete", () => {
    const result = validateCareerPlanExtraction({
      terminal_outcome: null,
      target_clusters: ["office"],
      stage_complete: true,
    });
    assert.equal(result.stage_complete, false);
  });

  it("accepts employment outcome with stage_complete", () => {
    const result = validateCareerPlanExtraction({
      terminal_outcome: "employment",
      target_clusters: ["Office Administration"],
      target_industries: ["Administrative Support"],
      onet_codes: [],
      assessment_results: { tabe: "Level D", cfwv: null, onet_or_cos: null, other: null },
      ecp_status: "in_progress",
      summary: "Student aims for office work via MOS.",
      needs_wioa_referral: false,
      wioa_reason: "",
      stage_complete: true,
    });
    assert.equal(result.terminal_outcome, "employment");
    assert.equal(result.stage_complete, true);
    assert.deepEqual(result.target_clusters, ["Office Administration"]);
    assert.equal(result.assessment_results.tabe, "Level D");
  });

  it("flags WIOA when requested", () => {
    const result = validateCareerPlanExtraction({
      terminal_outcome: "post_secondary",
      needs_wioa_referral: true,
      wioa_reason: "Needs tuition help for community college",
      stage_complete: true,
    });
    assert.equal(result.needs_wioa_referral, true);
    assert.match(result.wioa_reason, /tuition/i);
  });
});
