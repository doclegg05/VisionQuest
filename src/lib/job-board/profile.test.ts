import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSearchProfile, filterJobsForProfile } from "./profile";
import type { NormalizedJob } from "./types";

function createJob(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    opportunityType: "job",
    title: "Medical Assistant",
    company: "Valley Health",
    location: "Charleston, WV",
    salary: "$18/hour",
    salaryMin: 18,
    description: "Medical assistant role in clinic setting.",
    url: "https://example.com/job",
    source: "careeronestop",
    sourceType: "api",
    sourceId: "careeronestop:1",
    ...overrides,
  };
}

describe("buildSearchProfile", () => {
  it("normalizes list fields and preserves profile flags", () => {
    const profile = buildSearchProfile({
      region: "Charleston, WV",
      radius: 25,
      targetRoles: [" Medical Assistant ", "Medical Assistant", "Phlebotomist"],
      opportunityTypes: ["job", "training", "job"],
      excludedEmployers: [" Staffing Agency ", "Staffing Agency"],
      remoteOnly: true,
      wageFloor: 16,
    });

    assert.deepEqual(profile.opportunityTypes, ["job", "training"]);
    assert.deepEqual(profile.targetRoles, ["Medical Assistant", "Phlebotomist"]);
    assert.deepEqual(profile.excludedEmployers, ["Staffing Agency"]);
    assert.equal(profile.remoteOnly, true);
    assert.equal(profile.wageFloor, 16);
  });
});

describe("filterJobsForProfile", () => {
  it("filters by role, employer, remote hint, and wage floor", () => {
    const profile = buildSearchProfile({
      region: "Charleston, WV",
      radius: 25,
      opportunityTypes: ["training"],
      targetRoles: ["Front Desk"],
      excludedEmployers: ["Staffing Agency"],
      remoteOnly: true,
      wageFloor: 17,
    });

    const jobs = [
      createJob({
        sourceId: "1",
        location: "Remote",
        description: "Remote medical assistant supporting patient scheduling.",
      }),
      createJob({
        sourceId: "2",
        company: "Staffing Agency of WV",
        location: "Remote",
        description: "Remote medical assistant for contract assignment.",
      }),
      createJob({
        sourceId: "3",
        salaryMin: 15,
        salary: "$15/hour",
        location: "Remote",
      }),
      createJob({
        sourceId: "4",
        opportunityType: "training",
        title: "Front Desk Associate",
        location: "Remote",
        description: "Remote front desk scheduling role for a clinic.",
        company: "Community College",
      }),
    ];

    const filtered = filterJobsForProfile(jobs, profile);

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.sourceId, "4");
  });
});
