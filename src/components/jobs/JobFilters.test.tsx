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

  // UX finding #4 (2026-09-07 fluidity memo): 9 controls (3 proximity tabs +
  // search + 4 secondary selects + sort) in one flex-wrap row, every select
  // labeled only via sr-only text, wrapped into 4-5 rows of look-alike boxes
  // at 375px. Proximity + search stay always visible; the four secondary
  // selects (posted/pay/type/cluster) collapse behind one "Filters"
  // disclosure with visible labels inside it.
  it("collapses the four secondary filters behind a closed-by-default Filters disclosure", () => {
    const html = renderFilters();
    const trigger = html.match(/<button[^>]*aria-controls="job-filters-panel"[^>]*>/);
    assert.ok(trigger, "expected a Filters disclosure trigger button");
    assert.ok(trigger![0].includes('aria-expanded="false"'), "disclosure should start closed");
    assert.ok(trigger![0].includes("min-h-11"), "Filters button must meet the 44px touch-target floor");
    assert.match(html, /Filters/);

    const panel = html.match(/<div id="job-filters-panel"[^>]*>/);
    assert.ok(panel, "expected the filters panel container");
    assert.ok(panel![0].includes("hidden="), "panel should be hidden while the disclosure is closed");
  });

  it("keeps proximity tabs and search always visible outside the disclosure", () => {
    const html = renderFilters();
    const panelStart = html.indexOf('id="job-filters-panel"');
    const tablistIndex = html.indexOf('role="tablist"');
    const keywordIndex = html.indexOf('id="job-keyword"');
    assert.ok(tablistIndex >= 0 && tablistIndex < panelStart, "proximity tabs must render before the filters panel");
    assert.ok(keywordIndex >= 0 && keywordIndex < panelStart, "search box must render before the filters panel");
  });

  it("gives each secondary select a visible label, not only an sr-only one", () => {
    const html = renderFilters();
    for (const id of ["job-posted", "job-pay", "job-type", "job-cluster"]) {
      const label = html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`));
      assert.ok(label, `expected a <label> pointed at #${id}`);
      assert.ok(!label![0].includes("sr-only"), `label for #${id} must be visible, not sr-only: ${label![0]}`);
      assert.ok(label![1].trim().length > 0, `label for #${id} must have visible text`);
    }
  });

  it("shows a count on the Filters button when a secondary filter is active", () => {
    // renderToString inserts an HTML comment between adjacent text/expression
    // children for hydration ("Filters<!-- --> (1)") — strip comments before
    // reading the button's rendered text.
    const html = renderFilters({ minPay: "15" }).replace(/<!--.*?-->/g, "");
    const trigger = html.match(/<button[^>]*aria-controls="job-filters-panel"[^>]*>([^<]*)<\/button>/);
    assert.ok(trigger, "expected the Filters trigger button");
    assert.match(trigger![1], /Filters \(1\)/);
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
