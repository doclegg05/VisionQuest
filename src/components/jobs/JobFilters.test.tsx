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

  it("proximity tab buttons meet the 44px touch-target floor (D3)", () => {
    // The tabs only had `min-w-20` — no min-height — so at their py-1.5
    // text-sm sizing the collector measured them at 32px tall (80/87/106
    // wide x 32 tall across the Local/Remote/All labels). `min-h-11` is the
    // 44px Tailwind floor this design system uses everywhere else.
    const html = renderFilters();
    const tabButtonMatches = [...html.matchAll(/<button[^>]*role="tab"[^>]*class="([^"]*)"/g)];
    assert.equal(tabButtonMatches.length, 3, "expected Local/Remote/All tab buttons");
    for (const match of tabButtonMatches) {
      assert.ok(match[1].includes("min-h-11"), `tab button class missing min-h-11: ${match[1]}`);
    }
  });
});
