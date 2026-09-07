import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { JobList, type ListJob } from "./JobList";

function makeJob(n: number): ListJob {
  return {
    id: `job-${n}`,
    title: `Job ${n}`,
    company: "Acme",
    location: "Charleston, WV",
    workMode: "onsite",
    salary: null,
    matchScore: 0,
    matchLabel: null,
    clusters: [],
    savedStatus: null,
    url: "https://example.com",
  };
}

/**
 * UX finding #5: up to 100 full JobCards rendered as one uninterrupted
 * scroll with no "show more". First paint must be capped at 20.
 */
describe("JobList pagination", () => {
  it("shows an empty state with no Show more button when there are no jobs", () => {
    const html = renderToString(<JobList jobs={[]} onSave={() => {}} />);
    assert.ok(html.includes("No jobs available right now."));
    assert.ok(!html.includes("Show more jobs"));
  });

  it("renders every job with no Show more button when 20 or fewer jobs are given", () => {
    const jobs = Array.from({ length: 20 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />);
    for (const job of jobs) {
      assert.ok(html.includes(job.title), `expected ${job.title} in first paint`);
    }
    assert.ok(!html.includes("Show more jobs"), "20 jobs should not need a Show more button");
  });

  it("caps first paint at 20 cards and shows a Show more jobs button for a longer list", () => {
    const jobs = Array.from({ length: 47 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />);

    for (let i = 0; i < 20; i++) {
      assert.ok(html.includes(jobs[i].title), `expected ${jobs[i].title} in first paint`);
    }
    for (let i = 20; i < 47; i++) {
      assert.ok(!html.includes(jobs[i].title), `did not expect ${jobs[i].title} before Show more is pressed`);
    }
    assert.ok(html.includes("Show more jobs"));
  });

  it("Show more jobs button meets the 44px touch-target floor", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />);
    const match = html.match(/<button[^>]*>Show more jobs<\/button>/);
    assert.ok(match, "expected a Show more jobs button");
    assert.ok(match![0].includes("min-h-11"), `Show more button missing min-h-11: ${match![0]}`);
  });
});
