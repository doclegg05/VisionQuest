import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { JobList, firstRevealedIndex, JOB_LIST_PAGE_SIZE, type ListJob } from "./JobList";

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
    assert.ok(!/Show \d+ more jobs/.test(html));
  });

  it("renders every job with no Show more button when 20 or fewer jobs are given", () => {
    const jobs = Array.from({ length: 20 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />);
    for (const job of jobs) {
      assert.ok(html.includes(job.title), `expected ${job.title} in first paint`);
    }
    assert.ok(!/Show \d+ more jobs/.test(html), "20 jobs should not need a Show more button");
  });

  it("caps first paint at 20 cards and shows a Show N more jobs button naming the remaining count", () => {
    const jobs = Array.from({ length: 47 }, (_, i) => makeJob(i));
    // renderToString inserts an HTML comment between adjacent text/expression
    // children for hydration ("Show <!-- -->27<!-- --> more jobs") — strip
    // comments before reading the button's rendered text.
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />).replace(/<!--.*?-->/g, "");

    for (let i = 0; i < 20; i++) {
      assert.ok(html.includes(jobs[i].title), `expected ${jobs[i].title} in first paint`);
    }
    for (let i = 20; i < 47; i++) {
      assert.ok(!html.includes(jobs[i].title), `did not expect ${jobs[i].title} before Show more is pressed`);
    }
    // UX review CRITICAL note: "show the count on the button" — 47 - 20 = 27.
    assert.ok(html.includes("Show 27 more jobs"), "expected the remaining count on the button");
  });

  it("Show more jobs button meets the 44px touch-target floor", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />).replace(/<!--.*?-->/g, "");
    const match = html.match(/<button[^>]*>Show 10 more jobs<\/button>/);
    assert.ok(match, "expected a Show N more jobs button");
    assert.ok(match![0].includes("min-h-11"), `Show more button missing min-h-11: ${match![0]}`);
  });

  // UX review CRITICAL (2026-09-07): the button used to unmount when pressed
  // (remaining becomes 0), dropping focus to <body> with no announcement.
  // A stable focus target — the live region, always present — is the pin;
  // full keyboard-focus-transfer behavior needs a real DOM (see the
  // repo-wide renderToString-only test-infra limit noted in the report).
  it("always renders a polite live region announcing the visible count, even before Show more is pressed", () => {
    const jobs = Array.from({ length: 47 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />);
    const region = html.match(/<div aria-live="polite"[^>]*>[\s\S]*?<\/div>/);
    assert.ok(region, "expected an aria-live=polite status region");
    assert.ok(region![0].includes("sr-only"), "the live region should be visually hidden, not a visible banner");
  });

  // The revealed state itself (post-click) cannot be rendered via
  // renderToString — this repo's `.test.tsx` files have no jsdom/RTL to
  // simulate a click. firstRevealedIndex is the pure decision behind the
  // focus target, exported specifically so this logic is still pinned.
  it("does not mark any card as the focus target when every job already fits on one page", () => {
    const jobs = Array.from({ length: 20 }, (_, i) => makeJob(i));
    const html = renderToString(<JobList jobs={jobs} onSave={() => {}} />);
    assert.ok(!html.includes("data-first-revealed"));
    assert.equal(firstRevealedIndex(20), null);
    assert.equal(firstRevealedIndex(JOB_LIST_PAGE_SIZE), null);
  });

  it("firstRevealedIndex names the first hidden card as the focus target once there is one to reveal", () => {
    assert.equal(firstRevealedIndex(21), JOB_LIST_PAGE_SIZE);
    assert.equal(firstRevealedIndex(47), JOB_LIST_PAGE_SIZE);
  });
});
