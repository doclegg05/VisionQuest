import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRANSCRIPT_WINDOW, transcriptWindowFor } from "./transcript-window";

// FERPA review (2026-09-06) Part 2.3 / W9: the number of transcript turns a
// chat call discloses was chosen by provider NAME (`promptTier === "compact"`),
// so flipping a deployment to cloud for latency silently tripled the free-text
// exposure per call with nothing naming that as a decision. These tests pin
// the numbers as they stand today; changing any of them is an owner call.

describe("TRANSCRIPT_WINDOW", () => {
  it("pins today's numbers — 20 cloud, 6 local, 12 local on the discovery stages", () => {
    assert.deepEqual(TRANSCRIPT_WINDOW, { cloud: 20, local: 6, localDiscovery: 12 });
  });
});

describe("transcriptWindowFor", () => {
  it("cloud: 20 turns at every stage, discovery included", () => {
    for (const stage of ["discovery", "career_profile_review", "weekly", "general", "checkin"] as const) {
      assert.equal(transcriptWindowFor({ providerClass: "cloud", stage }), 20, stage);
    }
  });

  it("local: 6 turns on an ordinary stage", () => {
    for (const stage of ["weekly", "general", "checkin", "onboarding"] as const) {
      assert.equal(transcriptWindowFor({ providerClass: "local", stage }), 6, stage);
    }
  });

  it("local: 12 turns on discovery and career_profile_review", () => {
    assert.equal(transcriptWindowFor({ providerClass: "local", stage: "discovery" }), 12);
    assert.equal(transcriptWindowFor({ providerClass: "local", stage: "career_profile_review" }), 12);
  });

  it("a provider class that is not known to be cloud takes the local window (fail-safe)", () => {
    // No provider today resolves to "unknown" or "none" here (getProviderClass
    // names exactly "ollama" and "gemini"), so this changes no number in
    // production; it fixes the direction a future provider defaults to.
    assert.equal(transcriptWindowFor({ providerClass: "unknown", stage: "weekly" }), 6);
    assert.equal(transcriptWindowFor({ providerClass: "none", stage: "discovery" }), 12);
  });

  it("a missing stage takes the narrower local window", () => {
    assert.equal(transcriptWindowFor({ providerClass: "local", stage: null }), 6);
    assert.equal(transcriptWindowFor({ providerClass: "local", stage: undefined }), 6);
  });
});
