import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROFILE_SOURCE_COS_API,
  PROFILE_SOURCE_SAGE_INFERRED,
  PROFILE_SOURCE_STUDENT_REPORTED_COS,
  careerProvenanceLabel,
  isAssessedProfileSource,
} from "./career-provenance";

describe("isAssessedProfileSource", () => {
  it("treats student-reported and API results as assessed", () => {
    assert.equal(isAssessedProfileSource(PROFILE_SOURCE_STUDENT_REPORTED_COS), true);
    assert.equal(isAssessedProfileSource(PROFILE_SOURCE_COS_API), true);
  });

  it("treats sage_inferred (and anything unknown) as not assessed", () => {
    assert.equal(isAssessedProfileSource(PROFILE_SOURCE_SAGE_INFERRED), false);
    assert.equal(isAssessedProfileSource("garbage"), false);
    assert.equal(isAssessedProfileSource(""), false);
  });
});

describe("careerProvenanceLabel", () => {
  it("labels an assessed profile with the save date", () => {
    const label = careerProvenanceLabel(
      PROFILE_SOURCE_STUDENT_REPORTED_COS,
      new Date("2026-03-03T12:00:00Z"),
    );
    assert.match(label, /From your CareerOneStop results/);
    assert.match(label, /March 3, 2026/);
  });

  it("labels an API-sourced profile the same assessed way", () => {
    const label = careerProvenanceLabel(PROFILE_SOURCE_COS_API, new Date("2026-03-03T12:00:00Z"));
    assert.match(label, /From your CareerOneStop results/);
  });

  it("still reads as assessed when the date is missing", () => {
    const label = careerProvenanceLabel(PROFILE_SOURCE_STUDENT_REPORTED_COS, null);
    assert.match(label, /From your CareerOneStop results/);
    assert.doesNotMatch(label, /saved\s*[.,]/);
  });

  it("labels an inferred profile honestly — Sage's guess, not a test the student took", () => {
    const label = careerProvenanceLabel(PROFILE_SOURCE_SAGE_INFERRED, null);
    assert.match(label, /Sage's best guess from your chats/);
    assert.match(label, /not a test you took/);
  });

  it("falls back to the inferred label for unknown sources", () => {
    const label = careerProvenanceLabel("something-else", new Date());
    assert.match(label, /not a test you took/);
  });

  it("accepts an ISO string date (serialized rows)", () => {
    const label = careerProvenanceLabel(
      PROFILE_SOURCE_STUDENT_REPORTED_COS,
      "2026-03-03T12:00:00Z",
    );
    assert.match(label, /March 3, 2026/);
  });
});
