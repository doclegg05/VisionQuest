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
