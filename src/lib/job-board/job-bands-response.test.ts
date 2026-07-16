import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotateJobsWithBands,
  buildJobBandMap,
  buildJobBandingContext,
  type JobBandDiscovery,
} from "./job-bands-response";
import type { JobRecommendation } from "./types";

// Band annotation for the GET /api/jobs response: partitions the route's
// existing rankJobs() output via bandRankedJobs() and tags each job with
// core/stretch/wildcard — browse rows and discovery-less students get null.

function makeRecommendation(overrides: Partial<JobRecommendation> & { jobListingId: string }): JobRecommendation {
  return {
    score: 0,
    matchLabel: null,
    clusterOverlap: [],
    skillOverlap: [],
    matchReasons: [],
    ...overrides,
  };
}

const discovery: JobBandDiscovery = {
  topClusters: ["healthcare", "education"],
  hollandCode: "SEC",
  transferableSkills: JSON.stringify([
    { skill: "Customer Service", category: "interpersonal", evidence: "retail work" },
  ]),
};

// A class job with direct top-cluster overlap and a strong score.
const coreRec = makeRecommendation({
  jobListingId: "job-core",
  score: 82,
  matchLabel: "Strong match",
  clusterOverlap: ["healthcare"],
});

// Adjacency via transferable-skill overlap only — no direct cluster overlap.
const skillStretchRec = makeRecommendation({
  jobListingId: "job-stretch-skill",
  score: 44,
  skillOverlap: ["customer service"],
});

// Adjacency via RIASEC alignment only — no direct cluster overlap.
const riasecStretchRec = makeRecommendation({
  jobListingId: "job-stretch-riasec",
  score: 38,
  matchReasons: [{ type: "riasec", label: "Aligns with your Holland code: SEC", value: "SEC" }],
});

// Off-cluster, no adjacency signals at all.
const wildcardRec = makeRecommendation({ jobListingId: "job-wildcard", score: 12 });

const allRecs = [coreRec, skillStretchRec, riasecStretchRec, wildcardRec];

describe("buildJobBandingContext", () => {
  it("parses transferable skill names out of the stored JSON", () => {
    const context = buildJobBandingContext(discovery);
    assert.deepEqual(context.topClusters, ["healthcare", "education"]);
    assert.equal(context.hollandCode, "SEC");
    assert.deepEqual(context.transferableSkills, ["Customer Service"]);
  });
});

describe("buildJobBandMap", () => {
  it("assigns core to a direct top-cluster overlap with a strong score", () => {
    const bands = buildJobBandMap(allRecs, discovery);
    assert.equal(bands.get("job-core"), "core");
  });

  it("assigns stretch to transferable-skill adjacency without direct overlap", () => {
    const bands = buildJobBandMap(allRecs, discovery);
    assert.equal(bands.get("job-stretch-skill"), "stretch");
  });

  it("assigns stretch to RIASEC adjacency without direct overlap", () => {
    const bands = buildJobBandMap(allRecs, discovery);
    assert.equal(bands.get("job-stretch-riasec"), "stretch");
  });

  it("assigns wildcard to an off-cluster job with no adjacency signals", () => {
    const bands = buildJobBandMap(allRecs, discovery);
    assert.equal(bands.get("job-wildcard"), "wildcard");
  });

  it("keeps withheld wildcards (beyond the display cap) in the wildcard band", () => {
    const manyWildcards = Array.from({ length: 6 }, (_, i) =>
      makeRecommendation({ jobListingId: `wild-${i}`, score: 5 }),
    );
    const bands = buildJobBandMap(manyWildcards, discovery);
    for (const rec of manyWildcards) {
      assert.equal(bands.get(rec.jobListingId), "wildcard");
    }
  });
});

describe("annotateJobsWithBands", () => {
  const jobs = [
    { id: "job-core", title: "Patient Care Assistant", matchScore: 82, savedStatus: "saved" },
    { id: "job-stretch-skill", title: "Front Desk Coordinator", matchScore: 44, savedStatus: null },
    { id: "job-wildcard", title: "Welder", matchScore: 12, savedStatus: null },
    // Browse-pool row: present in the response but never in recommendations.
    { id: "browse-1", title: "Remote Data Entry", matchScore: 0, savedStatus: null },
  ];

  it("tags class jobs with their band and browse jobs (no recommendation) with null", () => {
    const annotated = annotateJobsWithBands(jobs, allRecs, discovery);
    const byId = new Map(annotated.map((job) => [job.id, job.band]));
    assert.equal(byId.get("job-core"), "core");
    assert.equal(byId.get("job-stretch-skill"), "stretch");
    assert.equal(byId.get("job-wildcard"), "wildcard");
    assert.equal(byId.get("browse-1"), null);
  });

  it("tags every job with band null when the student has no CareerDiscovery", () => {
    const annotated = annotateJobsWithBands(jobs, allRecs, null);
    for (const job of annotated) {
      assert.equal(job.band, null);
    }
  });

  it("preserves each job's pre-existing fields and does not mutate the input", () => {
    const annotated = annotateJobsWithBands(jobs, allRecs, discovery);

    assert.equal(annotated.length, jobs.length);
    annotated.forEach((job, index) => {
      const original = jobs[index];
      assert.equal(job.id, original.id);
      assert.equal(job.title, original.title);
      assert.equal(job.matchScore, original.matchScore);
      assert.equal(job.savedStatus, original.savedStatus);
      assert.deepEqual(
        Object.keys(job).sort(),
        [...Object.keys(original), "band"].sort(),
      );
      // Immutable: the input objects gain no band field.
      assert.equal("band" in original, false);
    });
  });
});
