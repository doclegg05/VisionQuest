import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreJob, rankJobs } from "./recommendation";

describe("scoreJob", () => {
  const baseJob = { id: "job-1", location: "Charleston, WV", clusters: ["office-admin"] };

  it("returns score 0 when no discovery data", () => {
    const result = scoreJob(baseJob, null, "Charleston, WV");
    assert.equal(result.score, 0);
    assert.equal(result.matchLabel, null);
    assert.deepEqual(result.clusterOverlap, []);
  });

  it("scores location match at 40 points", () => {
    const result = scoreJob(
      baseJob,
      { topClusters: [], hollandCode: null },
      "Charleston, WV",
    );
    assert.equal(result.score, 40); // Location match only
  });

  it("scores cluster match", () => {
    const result = scoreJob(
      { id: "job-2", location: "Somewhere else", clusters: ["office-admin"] },
      { topClusters: ["office-admin"], hollandCode: null },
      "Charleston, WV",
    );
    // No location match, but cluster match = 40
    assert.equal(result.score, 40);
    assert.deepEqual(result.clusterOverlap, ["office-admin"]);
  });

  it("scores location + cluster for strong match", () => {
    const result = scoreJob(
      baseJob,
      { topClusters: ["office-admin"], hollandCode: null },
      "Charleston, WV",
    );
    // Location (40) + Cluster (40) = 80
    assert.equal(result.score, 80);
    assert.equal(result.matchLabel, "Strong match");
  });

  it("scores RIASEC alignment", () => {
    const result = scoreJob(
      { id: "job-3", location: "Other", clusters: ["office-admin"] },
      { topClusters: [], hollandCode: "CSE" },
      "Charleston, WV",
    );
    // No location, no cluster match, but RIASEC: office-admin → CSE, student CSE → 3/3 match = 20
    assert.equal(result.score, 20);
  });

  it("returns 'Good match' for score 50-74", () => {
    const result = scoreJob(
      { id: "job-4", location: "Other", clusters: ["office-admin"] },
      { topClusters: ["office-admin"], hollandCode: "CSE" },
      "Charleston, WV",
    );
    // Cluster (40) + RIASEC (20) = 60
    assert.equal(result.score, 60);
    assert.equal(result.matchLabel, "Good match");
  });

  it("returns null matchLabel for score below 50", () => {
    const result = scoreJob(
      { id: "job-5", location: "Other", clusters: ["tech-digital"] },
      { topClusters: ["office-admin"], hollandCode: null },
      "Charleston, WV",
    );
    // No location, no cluster overlap, no RIASEC
    assert.equal(result.score, 0);
    assert.equal(result.matchLabel, null);
  });

  it("handles partial cluster overlap", () => {
    const result = scoreJob(
      { id: "job-6", location: "Other", clusters: ["office-admin", "tech-digital"] },
      { topClusters: ["office-admin", "finance-bookkeeping"], hollandCode: null },
      "Charleston, WV",
    );
    // 1 of 2 student clusters matched = 40 * (1/2) = 20
    assert.equal(result.score, 20);
    assert.deepEqual(result.clusterOverlap, ["office-admin"]);
  });
});

describe("rankJobs", () => {
  it("sorts jobs by score descending", () => {
    const jobs = [
      { id: "low", location: "Other", clusters: ["tech-digital"] },
      { id: "high", location: "Charleston, WV", clusters: ["office-admin"] },
      { id: "mid", location: "Other", clusters: ["office-admin"] },
    ];

    const discovery = { topClusters: ["office-admin"], hollandCode: null };
    const results = rankJobs(jobs, discovery, "Charleston, WV");

    assert.equal(results[0].jobListingId, "high"); // location + cluster = 80
    assert.equal(results[1].jobListingId, "mid");   // cluster only = 40
    assert.equal(results[2].jobListingId, "low");   // no match = 0
  });

  it("returns all zeroes when no discovery", () => {
    const jobs = [
      { id: "a", location: "Charleston, WV", clusters: ["office-admin"] },
      { id: "b", location: "Other", clusters: ["tech-digital"] },
    ];

    const results = rankJobs(jobs, null, "Charleston, WV");
    assert.ok(results.every((r) => r.score === 0));
  });

  it("returns empty array for empty jobs", () => {
    const results = rankJobs([], { topClusters: ["office-admin"], hollandCode: "CSE" }, "Charleston, WV");
    assert.equal(results.length, 0);
  });
});
