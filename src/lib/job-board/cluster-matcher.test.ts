import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchJobToClusters, matchJobsToClusters } from "./cluster-matcher";
import type { NormalizedJob } from "./types";

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    title: "Test Job",
    company: "Test Co",
    location: "Charleston, WV",
    salary: null,
    salaryMin: null,
    description: "",
    url: "https://example.com",
    source: "test",
    sourceType: "api",
    sourceId: "test:1",
    ...overrides,
  };
}

describe("matchJobToClusters", () => {
  it("matches admin assistant to office-admin cluster", () => {
    const job = makeJob({
      title: "Administrative Assistant",
      description: "Filing, scheduling, data entry, and office management tasks.",
    });
    const clusters = matchJobToClusters(job);
    assert.ok(clusters.includes("office-admin"), `Expected office-admin in ${JSON.stringify(clusters)}`);
  });

  it("matches bookkeeper to finance-bookkeeping cluster", () => {
    const job = makeJob({
      title: "Bookkeeper",
      description: "Manage accounts payable, QuickBooks, payroll processing.",
    });
    const clusters = matchJobToClusters(job);
    assert.ok(clusters.includes("finance-bookkeeping"), `Expected finance-bookkeeping in ${JSON.stringify(clusters)}`);
  });

  it("matches help desk to tech-digital cluster", () => {
    const job = makeJob({
      title: "Help Desk Technician",
      description: "IT support, troubleshoot computer issues, network setup.",
    });
    const clusters = matchJobToClusters(job);
    assert.ok(clusters.includes("tech-digital"), `Expected tech-digital in ${JSON.stringify(clusters)}`);
  });

  it("matches retail sales to customer-service cluster", () => {
    const job = makeJob({
      title: "Retail Sales Associate",
      description: "Customer service, sales, helping people find products.",
    });
    const clusters = matchJobToClusters(job);
    assert.ok(clusters.includes("customer-service"), `Expected customer-service in ${JSON.stringify(clusters)}`);
  });

  it("matches graphic designer to creative-design cluster", () => {
    const job = makeJob({
      title: "Graphic Designer",
      description: "Photoshop, Illustrator, visual design, marketing materials.",
    });
    const clusters = matchJobToClusters(job);
    assert.ok(clusters.includes("creative-design"), `Expected creative-design in ${JSON.stringify(clusters)}`);
  });

  it("prioritizes strong matches over weak substring hits", () => {
    // Substring matching is intentionally broad; this tests that strong matches
    // (sample job title + many keywords) outrank weak single-keyword substring matches
    const job = makeJob({
      title: "Administrative Assistant",
      description: "Scheduling, filing, data entry, front desk, organized.",
    });
    const clusters = matchJobToClusters(job);
    // office-admin should be the top match
    assert.equal(clusters[0], "office-admin");
    // Should have a higher score than any incidental substring matches
    assert.ok(clusters.length >= 1);
  });

  it("sorts by relevance — more matches ranked higher", () => {
    const job = makeJob({
      title: "Administrative Assistant",
      description: "Office management, typing, filing, scheduling, front desk reception, data entry, email, organized, detail-oriented.",
    });
    const clusters = matchJobToClusters(job);
    // office-admin should be first due to many keyword matches + sample job title match
    assert.equal(clusters[0], "office-admin");
  });

  it("can match multiple clusters", () => {
    const job = makeJob({
      title: "Office Manager",
      description: "Budget management, QuickBooks, Excel spreadsheets, filing, accounting, bookkeeping.",
    });
    const clusters = matchJobToClusters(job);
    assert.ok(clusters.length >= 2, `Expected at least 2 clusters, got ${clusters.length}`);
  });
});

describe("matchJobsToClusters", () => {
  it("returns a map keyed by sourceId", () => {
    const jobs = [
      makeJob({ sourceId: "test:1", title: "Bookkeeper", description: "accounting" }),
      makeJob({ sourceId: "test:2", title: "Astronaut", description: "space" }),
    ];
    const results = matchJobsToClusters(jobs);
    assert.equal(results.size, 2);
    assert.ok(results.has("test:1"));
    assert.ok(results.has("test:2"));
    assert.ok((results.get("test:1") ?? []).length > 0);
    assert.equal((results.get("test:2") ?? []).length, 0);
  });
});
