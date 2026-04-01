import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildJobFingerprint, dedupeJobsAcrossSources } from "./dedupe";
import type { NormalizedJob } from "./types";

function createJob(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    opportunityType: "job",
    title: "Medical Assistant",
    company: "Valley Health",
    location: "Charleston, WV",
    salary: null,
    salaryMin: null,
    description: "Baseline description",
    url: "https://example.com/job",
    source: "jsearch",
    sourceType: "api",
    sourceId: "jsearch:1",
    ...overrides,
  };
}

describe("buildJobFingerprint", () => {
  it("normalizes casing, punctuation, and spacing", () => {
    const first = buildJobFingerprint(
      createJob({
        title: "Medical Assistant",
        company: "Valley Health",
        location: "Charleston, WV",
      }),
    );
    const second = buildJobFingerprint(
      createJob({
        title: "medical assistant!!",
        company: "Valley   Health",
        location: "Charleston WV",
      }),
    );

    assert.equal(first, second);
  });
});

describe("dedupeJobsAcrossSources", () => {
  it("prefers official sources over aggregators for the same posting", () => {
    const jobs = [
      createJob({
        source: "jsearch",
        sourceId: "jsearch:1",
        description: "Short",
      }),
      createJob({
        source: "careeronestop",
        sourceId: "careeronestop:1",
        description: "Longer official description",
      }),
    ];

    const result = dedupeJobsAcrossSources(jobs);

    assert.equal(result.uniqueJobs.length, 1);
    assert.equal(result.uniqueJobs[0]?.source, "careeronestop");
  });

  it("keeps distinct postings when employer or title differs", () => {
    const jobs = [
      createJob({ sourceId: "jsearch:1" }),
      createJob({ sourceId: "jsearch:2", company: "Cabell Health" }),
      createJob({ sourceId: "jsearch:3", title: "Registered Nurse" }),
    ];

    const result = dedupeJobsAcrossSources(jobs);

    assert.equal(result.uniqueJobs.length, 3);
  });

  it("keeps distinct opportunity types even when title, employer, and location match", () => {
    const jobs = [
      createJob({ sourceId: "careeronestop:job:1", opportunityType: "job" }),
      createJob({ sourceId: "careeronestop:training:1", opportunityType: "training" }),
    ];

    const result = dedupeJobsAcrossSources(jobs);

    assert.equal(result.uniqueJobs.length, 2);
  });
});
