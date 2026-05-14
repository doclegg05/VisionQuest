import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildJobInteractionProfile,
  buildStudentJobProfile,
  parseTransferableSkillNames,
  scoreJob,
  rankJobs,
} from "./recommendation";

describe("scoreJob", () => {
  const baseJob = { id: "job-1", location: "Charleston, WV", clusters: ["office-admin"] };

  it("returns score 0 when no discovery data", () => {
    const result = scoreJob(baseJob, null, "Charleston, WV");
    assert.equal(result.score, 0);
    assert.equal(result.matchLabel, null);
    assert.deepEqual(result.clusterOverlap, []);
    assert.deepEqual(result.skillOverlap, []);
    assert.deepEqual(result.matchReasons, []);
  });

  it("scores location match at 40 points", () => {
    const result = scoreJob(
      baseJob,
      { topClusters: [], hollandCode: null },
      "Charleston, WV",
    );
    assert.equal(result.score, 40); // Location match only
  });

  it("scores remote jobs as location-compatible", () => {
    const result = scoreJob(
      { id: "remote-job", location: "Remote", clusters: ["office-admin"] },
      { topClusters: [], hollandCode: null },
      "Charleston, WV",
    );
    assert.equal(result.score, 40);
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
    assert.ok(result.matchReasons.some((reason) => reason.type === "location"));
    assert.ok(result.matchReasons.some((reason) => reason.type === "cluster"));
  });

  it("scores RIASEC alignment", () => {
    const result = scoreJob(
      { id: "job-3", location: "Other", clusters: ["office-admin"] },
      { topClusters: [], hollandCode: "CSE" },
      "Charleston, WV",
    );
    // No location, no cluster match, but RIASEC: office-admin → CSE, student CSE → 3/3 match = 20
    assert.equal(result.score, 20);
    assert.ok(result.matchReasons.some((reason) => reason.type === "riasec"));
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

  it("scores resume skill matches without career discovery", () => {
    const profile = buildStudentJobProfile({
      resumeSkills: ["Customer Service", "Microsoft Excel", "Scheduling"],
    });
    const result = scoreJob(
      {
        id: "job-7",
        title: "Remote Customer Support Coordinator",
        company: "Acme",
        location: "Remote",
        description: "Provide customer service, scheduling, and Microsoft Excel tracker updates.",
        clusters: ["customer-service"],
      },
      null,
      "Charleston, WV",
      profile,
    );

    assert.equal(result.score, 60); // Remote/location (40) + 3 skill matches (20)
    assert.equal(result.matchLabel, "Good match");
    assert.deepEqual(result.skillOverlap, ["Customer Service", "Microsoft Excel", "Scheduling"]);
    assert.ok(result.matchReasons.some((reason) => reason.type === "remote"));
    assert.ok(result.matchReasons.some((reason) => reason.label.includes("Microsoft Excel")));
  });

  it("caps combined discovery and skill scores at 100", () => {
    const profile = buildStudentJobProfile({
      resumeSkills: ["Data Entry", "Scheduling", "Microsoft Excel"],
    });
    const result = scoreJob(
      {
        id: "job-8",
        title: "Office Administrator",
        location: "Charleston, WV",
        description: "Data entry, scheduling, and Microsoft Excel reporting.",
        clusters: ["office-admin"],
      },
      { topClusters: ["office-admin"], hollandCode: "CSE" },
      "Charleston, WV",
      profile,
    );

    assert.equal(result.score, 100);
    assert.equal(result.matchLabel, "Strong match");
  });

  it("uses saved and applied job history as a preference signal", () => {
    const interactionProfile = buildJobInteractionProfile([
      {
        status: "applied",
        jobListing: {
          clusters: ["tech-digital"],
          company: "Acme",
          source: "remotive",
        },
      },
    ]);

    const result = scoreJob(
      {
        id: "job-9",
        title: "Remote Support Analyst",
        company: "Acme",
        location: "Other",
        description: "Support internal systems.",
        source: "remotive",
        clusters: ["tech-digital"],
      },
      null,
      "Charleston, WV",
      undefined,
      interactionProfile,
    );

    assert.equal(result.score, 12);
    assert.ok(result.matchReasons.some((reason) => reason.type === "preference"));
    assert.ok(result.matchReasons.some((reason) => reason.type === "feedback"));
  });

  it("lowers jobs similar to withdrawn saved jobs", () => {
    const interactionProfile = buildJobInteractionProfile([
      {
        status: "withdrawn",
        jobListing: {
          clusters: ["customer-service"],
          company: "Call Center Co",
          source: "jsearch",
        },
      },
    ]);

    const result = scoreJob(
      { id: "job-10", location: "Remote", clusters: ["customer-service"] },
      { topClusters: [], hollandCode: null },
      "Charleston, WV",
      undefined,
      interactionProfile,
    );

    assert.equal(result.score, 30); // Remote/location (40) - withdrawn cluster penalty (10)
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

  it("uses skill profile matches to rank jobs with the same discovery score", () => {
    const jobs = [
      {
        id: "generic",
        title: "Office Clerk",
        location: "Remote",
        description: "Maintain records and answer phones.",
        clusters: ["office-admin"],
      },
      {
        id: "skill-match",
        title: "Office Clerk",
        location: "Remote",
        description: "Use Microsoft Excel for scheduling and data entry.",
        clusters: ["office-admin"],
      },
    ];

    const profile = buildStudentJobProfile({
      resumeSkills: ["Microsoft Excel", "Scheduling", "Data Entry"],
    });
    const results = rankJobs(jobs, { topClusters: ["office-admin"], hollandCode: null }, "Charleston, WV", profile);

    assert.equal(results[0].jobListingId, "skill-match");
    assert.deepEqual(results[0].skillOverlap, ["Microsoft Excel", "Scheduling", "Data Entry"]);
  });

  it("uses interaction profile to break otherwise equal recommendations", () => {
    const jobs = [
      { id: "saved-pattern", location: "Other", clusters: ["finance-bookkeeping"] },
      { id: "other", location: "Other", clusters: ["customer-service"] },
    ];
    const interactionProfile = buildJobInteractionProfile([
      {
        status: "saved",
        jobListing: {
          clusters: ["finance-bookkeeping"],
          company: "Bookkeeping Co",
          source: "adzuna",
        },
      },
    ]);

    const results = rankJobs(jobs, null, "Charleston, WV", undefined, interactionProfile);

    assert.equal(results[0].jobListingId, "saved-pattern");
    assert.equal(results[0].score, 8);
  });
});

describe("student job profile helpers", () => {
  it("dedupes resume and discovery skills", () => {
    const profile = buildStudentJobProfile({
      resumeSkills: ["Microsoft Excel", " customer service "],
      resumeCertifications: ["Microsoft Excel"],
      discoverySkills: ["Customer Service", "Teamwork"],
    });

    assert.deepEqual(profile.skills, ["Microsoft Excel", "customer service", "Teamwork"]);
  });

  it("parses transferable skill names from CareerDiscovery JSON", () => {
    const result = parseTransferableSkillNames(JSON.stringify([
      { skill: "Communication", category: "people" },
      { skill: "Problem Solving", category: "thinking" },
      { skill: 42 },
    ]));

    assert.deepEqual(result, ["Communication", "Problem Solving"]);
  });

  it("returns an empty skill list for malformed transferable skill JSON", () => {
    assert.deepEqual(parseTransferableSkillNames("{bad json"), []);
  });
});
