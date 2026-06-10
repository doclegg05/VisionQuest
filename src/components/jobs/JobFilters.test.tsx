import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { JobFilters } from "./JobFilters";

function renderFilters(overrides?: Partial<Parameters<typeof JobFilters>[0]>) {
  return renderToString(
    <JobFilters
      cluster=""
      proximity="local"
      sort="recommended"
      keyword=""
      postedWithinDays=""
      minPay=""
      jobType=""
      localCount={3}
      remoteCount={2}
      onClusterChange={() => {}}
      onProximityChange={() => {}}
      onSortChange={() => {}}
      onKeywordChange={() => {}}
      onPostedChange={() => {}}
      onMinPayChange={() => {}}
      onJobTypeChange={() => {}}
      {...(overrides ?? {})}
    />,
  );
}

describe("JobFilters", () => {
  it("renders keyword search input with accessible label", () => {
    const html = renderFilters();
    assert.ok(html.includes('id="job-keyword"'));
    assert.ok(html.includes('type="search"'));
    assert.ok(html.includes("Search jobs by title, company, or keyword"));
  });

  it("renders posted-date, min-pay, and job-type selects", () => {
    const html = renderFilters();
    assert.ok(html.includes('id="job-posted"'));
    assert.ok(html.includes('id="job-pay"'));
    assert.ok(html.includes('id="job-type"'));
    assert.ok(html.includes("Last 7 days"));
    assert.ok(html.includes("$15+/hr"));
    assert.ok(html.includes("Part-time"));
  });

  it("reflects controlled filter values", () => {
    const html = renderFilters({ keyword: "nurse", jobType: "part_time", minPay: "15", postedWithinDays: "7" });
    assert.ok(html.includes('value="nurse"'));
    assert.ok(html.includes('<option value="part_time" selected="">'));
    assert.ok(html.includes('<option value="15" selected="">'));
    assert.ok(html.includes('<option value="7" selected="">'));
  });

  it("shows local and remote counts on the proximity tabs", () => {
    const html = renderFilters();
    assert.ok(html.includes("3 local jobs"));
    assert.ok(html.includes("2 remote jobs"));
  });
});
