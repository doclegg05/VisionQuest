import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandRankedJobs,
  type JobBandingContext,
} from "./banded-matching";
import type { JobMatchReason, JobRecommendation } from "./types";

const context: JobBandingContext = {
  topClusters: ["office-admin"],
  hollandCode: "CSE",
  transferableSkills: ["Microsoft Excel", "Customer Service"],
};

function recommendation(input: {
  id: string;
  score: number;
  clusters?: string[];
  skills?: string[];
  reasons?: JobMatchReason[];
}): JobRecommendation {
  return {
    jobListingId: input.id,
    score: input.score,
    matchLabel: input.score >= 75 ? "Strong match" : input.score >= 50 ? "Good match" : null,
    clusterOverlap: input.clusters ?? [],
    skillOverlap: input.skills ?? [],
    matchReasons: input.reasons ?? [],
  };
}

describe("bandRankedJobs", () => {
  it("places a strong direct-cluster and skill match in Core", () => {
    const directMatch = recommendation({
      id: "office-coordinator",
      score: 94,
      clusters: ["office-admin"],
      skills: ["Microsoft Excel"],
    });

    const result = bandRankedJobs([directMatch], context);

    assert.equal(result.core.label, "Core");
    assert.deepEqual(result.core.jobs.map((job) => job.jobListingId), ["office-coordinator"]);
    assert.equal(result.stretch.jobs.length, 0);
    assert.equal(result.wildcard.jobs.length, 0);
  });

  it("places skill and RIASEC adjacency without direct cluster overlap in Stretch", () => {
    const skillAdjacent = recommendation({
      id: "customer-support",
      score: 68,
      skills: ["Customer Service"],
    });
    const riasecAdjacent = recommendation({
      id: "community-outreach",
      score: 61,
      reasons: [{ type: "riasec", label: "Aligns with your Holland code: CSE", value: "CSE" }],
    });

    const result = bandRankedJobs([skillAdjacent, riasecAdjacent], context);

    assert.equal(result.stretch.label, "Stretch");
    assert.deepEqual(
      result.stretch.jobs.map((job) => job.jobListingId),
      ["customer-support", "community-outreach"],
    );
    assert.ok(result.stretch.jobs.every((job) => job.clusterOverlap.length === 0));
  });

  it("surfaces off-cluster Wildcards up to the cap and reports every withheld job", () => {
    const wildcards = [
      recommendation({ id: "greenhouse-assistant", score: 44 }),
      recommendation({ id: "museum-guide", score: 38 }),
      recommendation({ id: "animal-caregiver", score: 31 }),
      recommendation({ id: "bakery-apprentice", score: 22 }),
    ];

    const result = bandRankedJobs(wildcards, context, 2);

    assert.equal(result.wildcard.label, "Wildcard");
    assert.equal(result.wildcard.cap, 2);
    assert.deepEqual(
      result.wildcard.jobs.map((job) => job.jobListingId),
      ["greenhouse-assistant", "museum-guide"],
    );
    assert.deepEqual(
      result.wildcard.withheld.map((job) => job.jobListingId),
      ["animal-caregiver", "bakery-apprentice"],
    );
    assert.equal(result.wildcard.withheldCount, 2);
  });

  it("assigns every input to exactly one band with no duplicates or drops", () => {
    const ranked = [
      recommendation({ id: "core", score: 91, clusters: ["office-admin"] }),
      recommendation({ id: "stretch", score: 67, skills: ["Microsoft Excel"] }),
      recommendation({ id: "wildcard-shown", score: 45 }),
      recommendation({ id: "weak-direct-fallback", score: 40, clusters: ["office-admin"] }),
      recommendation({ id: "wildcard-withheld", score: 25 }),
    ];

    const result = bandRankedJobs(ranked, context, 1);
    const assignedIds = [
      ...result.core.jobs,
      ...result.stretch.jobs,
      ...result.wildcard.jobs,
      ...result.wildcard.withheld,
    ].map((job) => job.jobListingId);

    assert.equal(assignedIds.length, ranked.length);
    assert.equal(new Set(assignedIds).size, ranked.length);
    assert.deepEqual(new Set(assignedIds), new Set(ranked.map((job) => job.jobListingId)));
    assert.equal(result.wildcard.withheldCount, result.wildcard.withheld.length);
  });
});
