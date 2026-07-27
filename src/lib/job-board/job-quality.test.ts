import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedJob } from "./types";
import { filterQualityJobs } from "./job-quality";

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    title: "Office Assistant",
    company: "Acme",
    location: "Charleston, WV",
    salary: null,
    salaryMin: null,
    description: "Answer phones, schedule appointments, and keep records updated for the office.",
    url: "https://example.com/jobs/1",
    source: "jsearch",
    sourceType: "api",
    sourceId: "jsearch:1",
    ...overrides,
  };
}

test("filterQualityJobs accepts complete listings", () => {
  const result = filterQualityJobs([job()]);

  assert.equal(result.jobs.length, 1);
  assert.equal(result.rejected.length, 0);
});

test("filterQualityJobs rejects weak or invalid listings", () => {
  const result = filterQualityJobs([
    job({ sourceId: "missing-company", company: "" }),
    job({ sourceId: "bad-url", url: "not a url" }),
    job({ sourceId: "short-description", description: "Too short" }),
  ]);

  assert.equal(result.jobs.length, 0);
  assert.deepEqual(result.rejected.map((entry) => entry.reason), [
    "missing company",
    "invalid url",
    "description too short",
  ]);
});

test("filterQualityJobs removes duplicate listings within a scrape batch", () => {
  const result = filterQualityJobs([
    job({ sourceId: "jsearch:1" }),
    job({ sourceId: "jsearch:1", url: "https://example.com/jobs/dupe-source" }),
    job({ sourceId: "adzuna:2", url: "https://example.com/jobs/dupe-identity" }),
  ]);

  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.rejected.map((entry) => entry.reason), [
    "duplicate source id",
    "duplicate job posting",
  ]);
});

test("filterQualityJobs combines duplicate postings from different sources", () => {
  const result = filterQualityJobs([
    job({
      source: "usajobs",
      sourceId: "usajobs:1",
      title: "Office Assistant",
      company: "Acme Inc.",
      location: "Summersville, WV",
    }),
    job({
      source: "jsearch",
      sourceId: "jsearch:2",
      title: "Office Assistant - Full Time",
      company: "Acme",
      location: "Summersville, West Virginia",
      url: "https://example.com/jobs/2",
    }),
  ]);

  assert.equal(result.jobs.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "duplicate job posting");
});

// =============================================================================
// VQ-R-015 — the browse pool served senior big-tech roles to TANF/SNAP
// students. job-quality now rejects senior/leadership titles (word-boundary
// token match) so no source can put "Staff Engineer" in front of the default
// student audience, while "Team Leader" / "Senior Care Assistant" style
// entry-level titles stay.
// =============================================================================

function seniorityCase(title: string): NormalizedJob {
  return job({
    title,
    sourceId: `test:${title}`,
    url: `https://example.com/jobs/${encodeURIComponent(title)}`,
  });
}

function rejectionFor(title: string): string | null {
  const result = filterQualityJobs([seniorityCase(title)]);
  return result.rejected[0]?.reason ?? null;
}

test("seniority heuristic rejects senior/leadership titles (VQ-R-015)", () => {
  const seniorTitles = [
    "Senior Software Engineer",
    "Staff Engineer",
    "Principal Product Manager",
    "Team Lead",
    "Lead Barista",
    "Director of Engineering",
    "VP of Sales",
    "Head of People",
    "Solutions Architect",
    "SENIOR ACCOUNTANT", // case-insensitive
  ];
  for (const title of seniorTitles) {
    assert.equal(rejectionFor(title), "senior-level title", `expected "${title}" rejected`);
  }
});

test("seniority heuristic keeps entry-level titles (VQ-R-015)", () => {
  const entryTitles = [
    // "lead" must not match "leader"/"leadership" — word boundary only.
    "Team Leader",
    "Leadership Development Program Associate",
    // Elder-care roles are jobs FOR seniors' care, not senior-level roles.
    "Senior Care Assistant",
    "Senior Living Caregiver",
    // "vp" inside another word never matches.
    "MVP Program Coordinator",
    "Retail Associate",
    "Customer Service Representative",
  ];
  for (const title of entryTitles) {
    const result = filterQualityJobs([seniorityCase(title)]);
    assert.equal(
      result.rejected.length,
      0,
      `"${title}" rejected as: ${result.rejected[0]?.reason}`,
    );
    assert.equal(result.jobs.length, 1);
  }
});

test("care-context carve-out only neutralizes 'senior', not the rest of the title (VQ-R-015)", () => {
  assert.equal(rejectionFor("Senior Living Community Director"), "senior-level title");
});
